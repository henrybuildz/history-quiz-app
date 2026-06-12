-- Migration: add coin award to increment_user_score
--
-- Root cause this migration resolves:
--   The original function had no OUT out_coins / OUT out_coins_earned parameters
--   and never touched profiles.coins. The client now reads those fields; without
--   this migration the strict shape validation in saveQuizResult throws on every
--   save, the .catch() swallows it silently, and no coins are ever awarded.
--
-- Coin conversion rate: 1 coin per 10 XP (v_coins_rate = 0.1).
--   100 XP  (1 correct)  →  10 coins
--   500 XP  (5 correct)  →  50 coins
--   1000 XP (10 correct) → 100 coins  (enough for 5 hearts)
-- Tune v_coins_rate to adjust economy without touching client code.
--
-- XP-per-level: 500 (must match MOCK_PROFILE.xpToNextLevel in profile.tsx).
-- TODO: move this to a DB config table so frontend and backend stay in sync.
--
-- Security model:
--   SECURITY DEFINER  — runs as function owner (has UPDATE on profiles).
--   SET search_path   — prevents search_path injection.
--   auth.uid() check  — caller can only update their own profile.
--   anon guard        — reads JWT claim, not auth.users, so no extra DB query
--                       and no dependency on function-owner permissions.
--   score cap         — server enforces max per-session XP to prevent farming.
--
-- Atomicity: BEGIN/COMMIT wraps DROP + CREATE + GRANT/REVOKE so a failed CREATE
-- rolls back the DROP — the old function stays intact if the new one has errors.

BEGIN;

-- DROP uses input-parameter types only; OUT params are not part of the overload
-- key in PostgreSQL. IF EXISTS is a no-op on first deploy.
DROP FUNCTION IF EXISTS increment_user_score(UUID, INTEGER);

CREATE FUNCTION increment_user_score(
  p_user_id UUID,
  p_score   INTEGER,
  OUT out_total_score  INTEGER,
  OUT out_xp           INTEGER,
  OUT out_level        INTEGER,
  OUT out_coins        INTEGER,
  OUT out_coins_earned INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Must match MOCK_PROFILE.xpToNextLevel in profile.tsx.
  v_xp_per_level  CONSTANT INTEGER := 500;
  -- 10 % of session score becomes coins.
  v_coins_rate    CONSTANT NUMERIC := 0.1;
  -- Hard ceiling per session. Prevents score farming via direct RPC calls.
  -- 100 XP/correct × 200 questions = 20 000.
  v_max_score     CONSTANT INTEGER := 20000;

  -- Captured once so auth.uid() is not called twice in the same expression;
  -- two separate calls are not guaranteed to return the same value.
  v_caller       UUID;
  v_safe_score   INTEGER;
  v_coins_to_add INTEGER;
BEGIN
  -- ── Security checks ────────────────────────────────────────────────────────

  -- Capture the caller UUID exactly once.
  v_caller := auth.uid();

  -- Reject if there is no active JWT or if the JWT does not belong to p_user_id.
  -- This prevents any authenticated user from inflating another user's profile.
  IF v_caller IS NULL OR v_caller != p_user_id THEN
    -- Generic message: do not echo back p_user_id or v_caller — the error
    -- response is visible to the caller and leaking UUIDs aids enumeration.
    RAISE EXCEPTION 'increment_user_score: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reject anonymous JWTs by reading the claim directly from the already-
  -- validated Supabase JWT. Avoids a second DB round-trip to auth.users and
  -- removes the dependency on the function owner having SELECT on that table.
  -- COALESCE handles the case where the claim is absent (non-anonymous users
  -- do not include is_anonymous in their JWT).
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'increment_user_score: anonymous users cannot earn coins'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Input sanitisation ─────────────────────────────────────────────────────

  -- Clamp: floor at 0 (no negative deductions), ceiling at v_max_score (anti-cheat).
  -- v_max_score must equal MAX_SCORE_PER_SESSION in lib/supabase.ts so the client-side
  -- INSERT and this profile increment are always derived from the same capped value.
  v_safe_score   := LEAST(GREATEST(p_score, 0), v_max_score);
  v_coins_to_add := FLOOR(v_safe_score * v_coins_rate)::INTEGER;

  -- ── Atomic profile update ──────────────────────────────────────────────────

  -- All four columns are written in a single statement. PostgreSQL evaluates
  -- every RHS expression against the *old* row, so (xp + v_safe_score) in the
  -- level expression correctly uses the pre-update xp.
  UPDATE profiles
  SET
    total_score = total_score + v_safe_score,
    -- Wrap xp within the current level bucket.
    xp          = (xp + v_safe_score) % v_xp_per_level,
    -- Integer division counts level thresholds crossed; handles multi-level-up.
    level       = level + (xp + v_safe_score) / v_xp_per_level,
    -- Award coins atomically with XP so balance is always consistent.
    coins       = coins + v_coins_to_add
  WHERE id = p_user_id
  RETURNING total_score, xp, level, coins
  INTO out_total_score, out_xp, out_level, out_coins;

  -- RETURNING … INTO sets FOUND = false when no row matched.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'increment_user_score: no profile row for user_id=%', p_user_id;
  END IF;

  -- Set last so the value is provably identical to what was added to coins above.
  out_coins_earned := v_coins_to_add;
END;
$$;

-- In PG ≤ 14, CREATE FUNCTION auto-grants EXECUTE to PUBLIC. Both the `anon`
-- and `authenticated` roles inherit from PUBLIC. REVOKE FROM anon alone does NOT
-- remove the PUBLIC grant — anon still executes via inheritance. REVOKE FROM PUBLIC
-- strips the grant from all inheriting roles; the explicit GRANT then re-adds it
-- only to authenticated. In PG ≥ 15 there is no auto PUBLIC grant, so the REVOKE
-- is a no-op but the GRANT is still required.
REVOKE ALL ON FUNCTION increment_user_score(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_user_score(UUID, INTEGER) TO authenticated;

COMMIT;
