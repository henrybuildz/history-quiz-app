-- Migration: allow anonymous users to save quiz sessions
--
-- Previously save_quiz_session rejected any caller whose JWT carried
-- is_anonymous=true. Anonymous users in Supabase have a real UUID in
-- auth.users and a profiles row created during onboarding (username screen),
-- so their saves are structurally identical to signed-in users.
--
-- The auth.uid() == p_user_id check still applies — a caller can only write
-- to their own profile. The only change is removing the is_anonymous guard.
--
-- Note: no BEGIN/COMMIT wrapper — the Supabase SQL editor auto-wraps in a
-- transaction and does not support explicit transaction blocks containing
-- PL/pgSQL function bodies (parser error on DECLARE inside the function body).

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
  v_xp_per_level  CONSTANT INTEGER := 500;       -- must match XP_PER_LEVEL in lib/supabase.ts
  v_coins_rate    CONSTANT NUMERIC := 0.1;       -- 10% of session score becomes coins
  v_max_score     CONSTANT INTEGER := 20000;     -- must match MAX_SCORE_PER_SESSION in lib/supabase.ts
  v_max_era_len   CONSTANT INTEGER := 100;
  v_int_max       CONSTANT BIGINT  := 2147483647;
  v_caller        UUID;
  v_safe_score    INTEGER;
  v_coins_to_add  INTEGER;
BEGIN

  -- ── Security ──────────────────────────────────────────────────────────────────

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Anonymous check intentionally removed: anonymous users earn XP and coins
  -- like signed-in users. Their data is device-local (lost if app is uninstalled
  -- without linking an email), but the writes are valid.

  -- ── Input validation ──────────────────────────────────────────────────────────

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

  v_safe_score   := LEAST(GREATEST(p_score, 0), v_max_score);
  v_coins_to_add := FLOOR(v_safe_score * v_coins_rate)::INTEGER;

  -- ── Step 1: record the session ────────────────────────────────────────────────

  INSERT INTO quiz_sessions(user_id, era, score, questions_answered, questions_correct, completed)
  VALUES (p_user_id, p_era, v_safe_score, p_questions_answered, p_questions_correct, true);

  -- ── Step 2: update profile ────────────────────────────────────────────────────

  UPDATE profiles
  SET
    total_score = LEAST(total_score + v_safe_score, v_int_max)::INTEGER,
    xp          = (xp + v_safe_score) % v_xp_per_level,
    level       = level + (xp + v_safe_score) / v_xp_per_level,
    coins       = LEAST(coins + v_coins_to_add, v_int_max)::INTEGER
  WHERE id = p_user_id
  RETURNING total_score, xp, level, coins
  INTO out_total_score, out_xp, out_level, out_coins;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_quiz_session: profile not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  out_coins_earned := v_coins_to_add;
END;
$$;

REVOKE ALL ON FUNCTION save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER) TO authenticated;
