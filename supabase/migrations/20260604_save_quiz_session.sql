-- Migration: atomic quiz session save
--
-- Replaces the two-step JS pattern (INSERT quiz_sessions + RPC increment_user_score).
-- Both writes happen in one PL/pgSQL transaction — either both commit or neither does,
-- eliminating the orphaned-session / lost-score failure mode.
--
-- Also drops increment_user_score, which is now dead code and a latent
-- privilege-escalation vector (authenticated users could call it directly to
-- increment their score without creating a session row).
--
-- Security notes:
--   - All error messages are generic — no user data (UUIDs, scores) in responses.
--   - NULL checks precede comparisons — NULL < 1 evaluates to NULL in PostgreSQL,
--     silently bypassing comparison-only guards.
--   - p_era has a length cap — prevents unbounded strings reaching quiz_sessions.
--   - total_score / coins are capped at INTEGER max as an overflow safety net;
--     the proper long-term fix is a schema migration to BIGINT.

-- Note: no BEGIN/COMMIT wrapper — the Supabase SQL editor auto-wraps in a
-- transaction and does not support explicit transaction blocks containing
-- PL/pgSQL function bodies (parser error on DECLARE inside the function body).

DROP FUNCTION IF EXISTS increment_user_score(UUID, INTEGER);
DROP FUNCTION IF EXISTS save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER);

CREATE FUNCTION save_quiz_session(
  p_user_id             UUID,
  p_era                 TEXT,
  p_score               INTEGER,
  p_questions_answered  INTEGER,
  p_questions_correct   INTEGER,
  OUT out_total_score   INTEGER,
  OUT out_xp            INTEGER,
  OUT out_level         INTEGER,
  OUT out_coins         INTEGER,
  OUT out_coins_earned  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp_per_level  CONSTANT INTEGER := 500;       -- must match MOCK_PROFILE.xpToNextLevel in profile.tsx
  v_coins_rate    CONSTANT NUMERIC := 0.1;       -- 10% of session score becomes coins
  v_max_score     CONSTANT INTEGER := 20000;     -- must match MAX_SCORE_PER_SESSION in lib/supabase.ts
  v_max_era_len   CONSTANT INTEGER := 100;       -- guards against oversized era strings
  v_int_max       CONSTANT BIGINT  := 2147483647; -- INTEGER ceiling for overflow cap
  v_caller        UUID;
  v_safe_score    INTEGER;
  v_coins_to_add  INTEGER;
BEGIN

  -- ── Security ──────────────────────────────────────────────────────────────────

  -- Explicit NULL check before any comparison — NULL != anything evaluates to NULL
  -- (not TRUE) in PostgreSQL, silently bypassing the inequality check below.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Anonymous check. COALESCE handles absent claim (non-anonymous users).
  -- Generic message: all auth failures return the same string to prevent
  -- enumeration of which specific check failed.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────────────

  -- NULL check must precede trim() — trim(NULL) returns NULL, not ''.
  -- Length cap prevents unbounded strings reaching quiz_sessions.era.
  IF p_era IS NULL OR trim(p_era) = '' OR length(trim(p_era)) > v_max_era_len THEN
    RAISE EXCEPTION 'save_quiz_session: era is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_score IS NULL THEN
    RAISE EXCEPTION 'save_quiz_session: score must not be null'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_questions_answered IS NULL OR p_questions_answered < 1 THEN
    RAISE EXCEPTION 'save_quiz_session: questions_answered must be >= 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_questions_correct IS NULL
    OR p_questions_correct < 0
    OR p_questions_correct > p_questions_answered
  THEN
    RAISE EXCEPTION 'save_quiz_session: questions_correct out of valid range'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Sanitise score ────────────────────────────────────────────────────────────
  -- p_score confirmed non-null above; GREATEST/LEAST are safe.
  v_safe_score   := LEAST(GREATEST(p_score, 0), v_max_score);
  v_coins_to_add := FLOOR(v_safe_score * v_coins_rate)::INTEGER;

  -- ── Step 1: record the session ────────────────────────────────────────────────
  INSERT INTO quiz_sessions(user_id, era, score, questions_answered, questions_correct, completed)
  VALUES (p_user_id, p_era, v_safe_score, p_questions_answered, p_questions_correct, true);

  -- ── Step 2: update profile ────────────────────────────────────────────────────
  -- PostgreSQL evaluates all SET RHS against the OLD row, so both
  -- (xp + v_safe_score) references correctly use the pre-update xp value.
  --
  -- LEAST(..., v_int_max) on total_score and coins caps at INTEGER max to prevent
  -- overflow. v_int_max is BIGINT so the addition doesn't itself overflow before
  -- the cap is applied. Proper fix: migrate these columns to BIGINT.
  UPDATE profiles
  SET
    total_score = LEAST(total_score + v_safe_score, v_int_max)::INTEGER,
    xp          = (xp + v_safe_score) % v_xp_per_level,
    level       = level + (xp + v_safe_score) / v_xp_per_level,
    coins       = LEAST(coins + v_coins_to_add, v_int_max)::INTEGER
  WHERE id = p_user_id
  RETURNING total_score, xp, level, coins
  INTO out_total_score, out_xp, out_level, out_coins;

  -- Generic message — p_user_id deliberately excluded to avoid leaking
  -- UUIDs into client-visible error responses and application logs.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_quiz_session: profile not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  out_coins_earned := v_coins_to_add;
END;
$$;

-- In PG <= 14, CREATE FUNCTION auto-grants EXECUTE to PUBLIC. REVOKE FROM PUBLIC
-- strips the grant from all inheriting roles; GRANT re-adds it only to authenticated.
-- In PG >= 15 the REVOKE is a no-op but the GRANT is still required.
REVOKE ALL ON FUNCTION save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;
