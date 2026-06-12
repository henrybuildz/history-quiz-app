-- Migration: add get_profile_stats aggregate RPC
--
-- Root cause this migration resolves:
--   getProfileStats (lib/supabase.ts) previously fetched every quiz_sessions row
--   for a user and summed them in JavaScript. For a user with 5 000 sessions that
--   is ~80 KB per profile-screen focus; with no LIMIT the query grows without bound.
--   This function collapses the full scan to a single aggregate row on the DB side.
--
-- Return shape: OUT parameters so PostgREST returns a single plain object,
-- consistent with increment_user_score and spend_coins. RETURNS TABLE would
-- produce an array, which assertRpcObject in the client rejects.
--
-- Security:
--   SECURITY DEFINER  — runs as function owner (has SELECT on quiz_sessions).
--   SET search_path   — prevents search_path injection.
--   No auth.uid() check — quiz counts and accuracy are non-sensitive. Add one
--     if per-user stat privacy becomes a requirement.
--
-- COALESCE around each SUM so a user with zero completed sessions gets 0, not NULL.

BEGIN;

CREATE OR REPLACE FUNCTION get_profile_stats(
  p_user_id      UUID,
  OUT quizzes_played BIGINT,
  OUT total_correct  BIGINT,
  OUT total_answered BIGINT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT                              AS quizzes_played,
    COALESCE(SUM(questions_correct),  0)::BIGINT  AS total_correct,
    COALESCE(SUM(questions_answered), 0)::BIGINT  AS total_answered
  FROM quiz_sessions
  WHERE user_id   = p_user_id
    AND completed = true;
$$;

REVOKE ALL ON FUNCTION get_profile_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_profile_stats(UUID) TO authenticated;

COMMIT;
