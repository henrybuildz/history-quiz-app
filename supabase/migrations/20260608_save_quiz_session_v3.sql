-- Migration: extend save_quiz_session with achievement unlock logic
--
-- New optional input parameters (default to safe values; existing callers
-- that omit them continue to work without change):
--   p_max_streak      INTEGER DEFAULT 0     — longest correct run this session
--   p_perfect         BOOLEAN DEFAULT FALSE — no wrong answers in session
--   p_lives_remaining INTEGER DEFAULT 0     — lives left when quiz ended
--
-- New output parameter:
--   out_newly_unlocked TEXT[] — achievement IDs unlocked this session as a
--                               native array (empty array when nothing new).
--                               Using TEXT[] avoids client-side string parsing
--                               and delimiter-collision risk in future IDs.
--
-- Achievement unlock runs inside the same transaction as the session INSERT and
-- profile UPDATE, so coins and unlock rows are always consistent.
--
-- Security notes:
--   - SECURITY DEFINER + fixed search_path prevents schema-injection.
--   - auth.uid() IS DISTINCT FROM p_user_id: callers can only write their own data.
--   - GRANT to `authenticated` only — the unauthenticated `anon` role cannot invoke
--     this function; anonymous sign-in users have the `authenticated` role.
--   - Generic error messages — no UUIDs, scores, or state in responses.
--   - Score/level/era achievements are server-derived; the three new params only
--     affect session-scoped checks. Spoofing streak/perfect/lives_remaining
--     can unlock at most a handful of low-value achievements, not score or XP.
--   - ON CONFLICT DO NOTHING handles the concurrent multi-device edge case:
--     the second INSERT is silently dropped; coin_totals joins only on
--     actually-inserted rows, so coins are awarded exactly once.

DROP FUNCTION IF EXISTS save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER);

CREATE FUNCTION save_quiz_session(
  p_user_id             UUID,
  p_era                 TEXT,
  p_score               INTEGER,
  p_questions_answered  INTEGER,
  p_questions_correct   INTEGER,
  p_max_streak          INTEGER DEFAULT 0,
  p_perfect             BOOLEAN DEFAULT FALSE,
  p_lives_remaining     INTEGER DEFAULT 0,
  OUT out_total_score    INTEGER,
  OUT out_xp             INTEGER,
  OUT out_level          INTEGER,
  OUT out_coins          INTEGER,
  OUT out_coins_earned   INTEGER,
  OUT out_newly_unlocked TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp_per_level      CONSTANT INTEGER := 500;   -- must match XP_PER_LEVEL in lib/supabase.ts
  v_coins_rate        CONSTANT NUMERIC := 0.1;
  v_max_score         CONSTANT INTEGER := 20000; -- must match MAX_SCORE_PER_SESSION in lib/supabase.ts
  v_max_era_len       CONSTANT INTEGER := 100;
  v_int_max           CONSTANT BIGINT  := 2147483647;
  -- Total number of non-Mixed eras in the Era union type (types/index.ts).
  -- Verified 2026-06-08: 30 non-Mixed members. Update this constant and
  -- types/index.ts together whenever a new era is added to the catalog.
  v_era_target        CONSTANT INTEGER := 30;
  v_safe_score        INTEGER;
  v_session_coins     INTEGER;
  v_achievement_coins INTEGER;
  v_quiz_count        BIGINT;  -- total sessions for this user after Step 1 INSERT
  v_era_real_count    BIGINT;  -- COUNT(DISTINCT era) excluding 'Mixed'
  v_perfect_count     BIGINT;  -- sessions where questions_correct = questions_answered
  v_accuracy          NUMERIC; -- SUM(correct)/SUM(answered) across all sessions
  -- OPT O1: per-era counts cached in Step 3 alongside the other aggregates.
  -- Previously these were 5 separate correlated subqueries inside the eligible CTE,
  -- each triggering an independent index lookup on idx_quiz_sessions_user_era.
  -- They are now FILTER aggregates computed in the same single scan as v_quiz_count.
  v_cnt_rome          BIGINT;  -- sessions with era = 'Ancient Rome'
  v_cnt_egypt         BIGINT;  -- sessions with era = 'Ancient Egypt'
  v_cnt_ww2           BIGINT;  -- sessions with era = 'World War II'
  v_cnt_ancients      BIGINT;  -- distinct ancient eras (Rome, Greece, Egypt) played
  v_cnt_wartime       BIGINT;  -- distinct world-war eras (WWI, WWII) played
BEGIN

  -- ── Security ──────────────────────────────────────────────────────────────────

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- OPT O2: IS DISTINCT FROM replaces the two-step v_caller := auth.uid() /
  -- IF v_caller IS NULL OR v_caller != p_user_id pattern. IS DISTINCT FROM
  -- handles NULL on the left side correctly (NULL IS DISTINCT FROM any-uuid = TRUE),
  -- so a missing auth session is rejected without a dedicated NULL check.
  -- p_user_id is already guaranteed non-null by the check above.
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'save_quiz_session: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  -- DEFAULT handles the omitted-param case; COALESCE handles an explicit NULL.
  p_max_streak      := COALESCE(p_max_streak,     0);
  p_perfect         := COALESCE(p_perfect,         FALSE);
  p_lives_remaining := COALESCE(p_lives_remaining, 0);

  -- Clamp client-reported session values to plausible ranges so a malicious
  -- client cannot manufacture streak or lives achievements by sending huge numbers.
  -- Upper bound for streak is questions_answered (can't streak more than you answered).
  -- Upper bound for lives is LIVES_PER_QUIZ (3) — but we use a generous 20 to avoid
  -- fragility against future rule changes while still blocking absurd inputs.
  p_max_streak      := GREATEST(0, LEAST(p_max_streak,     p_questions_answered));
  p_lives_remaining := GREATEST(0, LEAST(p_lives_remaining, 20));

  -- Normalize p_perfect against the stored counts. A client lying about
  -- p_perfect=TRUE while sending questions_correct < questions_answered
  -- would otherwise earn perfect_1 on a non-perfect run.
  p_perfect := p_perfect AND (p_questions_correct = p_questions_answered);

  -- ── Step 1: record the session ────────────────────────────────────────────────

  v_safe_score    := LEAST(GREATEST(p_score, 0), v_max_score);
  v_session_coins := FLOOR(v_safe_score * v_coins_rate)::INTEGER;

  INSERT INTO quiz_sessions(user_id, era, score, questions_answered, questions_correct, completed)
  VALUES (p_user_id, p_era, v_safe_score, p_questions_answered, p_questions_correct, true);

  -- ── Step 2: update profile ────────────────────────────────────────────────────

  UPDATE profiles
  SET
    -- Cast to BIGINT before adding so the intermediate sum cannot overflow INTEGER
    -- even when total_score is near 2,147,483,647. LEAST then clamps back to INTEGER range.
    total_score = LEAST(total_score::BIGINT + v_safe_score, v_int_max)::INTEGER,
    xp          = (xp + v_safe_score) % v_xp_per_level,
    level       = level + (xp + v_safe_score) / v_xp_per_level,
    coins       = LEAST(coins::BIGINT + v_session_coins, v_int_max)::INTEGER
  WHERE id = p_user_id
  RETURNING total_score, xp, level, coins
  INTO out_total_score, out_xp, out_level, out_coins;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_quiz_session: profile not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  out_coins_earned := v_session_coins;

  -- ── Step 3: cache ALL aggregate stats in one scan ────────────────────────────
  -- Runs after Step 1 INSERT so every count includes the current session.
  --
  -- OPT O1: the five per-era correlated subqueries that previously fired inside
  -- the eligible CTE (era_rome, era_egypt, era_ww2, ancients, wartime) are now
  -- FILTER aggregates here. PostgreSQL computes all FILTER clauses in the same
  -- sequential pass over the rows selected by WHERE user_id = p_user_id, so the
  -- additional columns cost nothing beyond what the scan already reads.
  -- Net change: 6 index lookups per save (1 Step-3 scan + 5 CTE subqueries)
  -- reduced to 1 (the Step-3 scan alone). The CTE now contains zero correlated
  -- subqueries — every condition references a pre-computed variable.
  --
  -- COUNT(DISTINCT era) FILTER (...) is valid PostgreSQL 9.4+ syntax.

  SELECT
    COUNT(*),
    COUNT(DISTINCT era)   FILTER (WHERE era != 'Mixed'),
    COUNT(*)              FILTER (WHERE questions_correct = questions_answered),
    CASE WHEN SUM(questions_answered) > 0
         THEN SUM(questions_correct)::NUMERIC / SUM(questions_answered)
         ELSE 0.0 END,
    COUNT(*)              FILTER (WHERE era = 'Ancient Rome'),
    COUNT(*)              FILTER (WHERE era = 'Ancient Egypt'),
    COUNT(*)              FILTER (WHERE era = 'World War II'),
    COUNT(DISTINCT era)   FILTER (WHERE era IN ('Ancient Rome', 'Ancient Greece', 'Ancient Egypt')),
    COUNT(DISTINCT era)   FILTER (WHERE era IN ('World War I', 'World War II'))
  INTO
    v_quiz_count,
    v_era_real_count,
    v_perfect_count,
    v_accuracy,
    v_cnt_rome,
    v_cnt_egypt,
    v_cnt_ww2,
    v_cnt_ancients,
    v_cnt_wartime
  FROM quiz_sessions
  WHERE user_id = p_user_id;

  -- ── Step 4: check and unlock achievements ─────────────────────────────────────
  --
  -- MATERIALIZED guarantees eligible is evaluated exactly once.
  -- Without it, PostgreSQL 12+ may inline the CTE, re-running all subqueries
  -- for each reference (twice: once for `inserted`, once for `coin_totals`).
  --
  -- NOT EXISTS in eligible filters already-owned achievements before any
  -- condition is evaluated, so the cost is proportional to unearned count.
  --
  -- ON CONFLICT DO NOTHING in inserted makes the whole block idempotent under
  -- concurrent saves (multi-device). coin_totals joins on inserted's RETURNING
  -- output, so coins are counted only for rows actually newly written.

  WITH eligible AS MATERIALIZED (
    SELECT a.id, a.reward_coins
    FROM   achievements a
    WHERE  NOT EXISTS (
             SELECT 1 FROM user_achievements ua
             WHERE ua.user_id = p_user_id AND ua.achievement_id = a.id
           )
    AND (
      /* ── Quiz count ──────────────────────────────────────────────────────── */
      -- quiz_1 has NO count guard. NOT EXISTS already ensures it fires at most
      -- once. Omitting the guard is intentional: users who played quizzes before
      -- achievements were deployed would be permanently locked out if we required
      -- v_quiz_count = 1 here. Any session where they don't yet have quiz_1 awards it.
      (a.id = 'quiz_1')
      OR (a.id = 'quiz_10'  AND v_quiz_count >= 10)
      OR (a.id = 'quiz_50'  AND v_quiz_count >= 50)
      OR (a.id = 'quiz_100' AND v_quiz_count >= 100)

      /* ── Level milestones (out_level already reflects this session) ──────── */
      OR (a.id = 'level_2'  AND out_level >= 2)
      OR (a.id = 'level_5'  AND out_level >= 5)
      OR (a.id = 'level_10' AND out_level >= 10)
      OR (a.id = 'level_20' AND out_level >= 20)

      /* ── Score milestones (out_total_score already reflects this session) ── */
      OR (a.id = 'score_1k'   AND out_total_score >= 1000)
      OR (a.id = 'score_10k'  AND out_total_score >= 10000)
      OR (a.id = 'score_50k'  AND out_total_score >= 50000)
      OR (a.id = 'score_100k' AND out_total_score >= 100000)

      /* ── Session-specific (client-reported, normalized server-side) ─────── */
      OR (a.id = 'perfect_1' AND p_perfect)
      OR (a.id = 'perfect_5' AND p_perfect AND v_perfect_count >= 5)
      OR (a.id = 'streak_5'  AND p_max_streak >= 5)
      OR (a.id = 'streak_10' AND p_max_streak >= 10)
      -- iron_will: 0 lives remaining AND at least one correct answer.
      -- NOT p_perfect guard: a perfect run means no wrong answers means no lives
      -- lost, so p_lives_remaining=0 + p_perfect=TRUE is a logical contradiction
      -- that only a lying client can produce. Blocking it closes the cheat path
      -- where a client sends p_lives_remaining=-1 (clamped to 0) on a perfect run
      -- to double-earn iron_will + perfect_1.
      OR (a.id = 'iron_will' AND p_lives_remaining = 0 AND p_questions_correct > 0 AND NOT p_perfect)

      /* ── Accuracy ────────────────────────────────────────────────────────── */
      OR (a.id = 'accuracy_90' AND v_quiz_count >= 10 AND v_accuracy >= 0.90)

      /* ── Era counts — all reference Step 3 variables, zero CTE subqueries ── */
      OR (a.id = 'era_rome'  AND v_cnt_rome  >= 3)
      OR (a.id = 'era_egypt' AND v_cnt_egypt >= 3)
      OR (a.id = 'era_ww2'   AND v_cnt_ww2   >= 3)
      OR (a.id = 'era_10'    AND v_era_real_count >= 10)
      -- v_era_target (30) = number of non-Mixed Era union members in types/index.ts.
      -- Update both together when adding a new era to the catalog.
      OR (a.id = 'era_all'   AND v_era_real_count >= v_era_target)

      /* ── Secret combos ───────────────────────────────────────────────────── */
      OR (a.id = 'ancients' AND v_cnt_ancients = 3)
      OR (a.id = 'wartime'  AND v_cnt_wartime  = 2)
      -- dawn_of_time requires v_quiz_count = 1 — only earnable on the very first
      -- quiz. Unlike quiz_1, "catch-up" is nonsensical here (the moment has passed).
      OR (a.id = 'dawn_of_time' AND v_quiz_count = 1 AND p_era = 'Early Civilizations')
    )
  ),
  inserted AS (
    INSERT INTO user_achievements (user_id, achievement_id)
    SELECT p_user_id, id FROM eligible
    ON CONFLICT DO NOTHING
    RETURNING achievement_id
  ),
  coin_totals AS (
    -- Join on inserted (not eligible) so coins are counted only for newly-written
    -- rows, not for achievements that conflicted with a concurrent INSERT.
    SELECT COALESCE(SUM(e.reward_coins), 0)::INTEGER                             AS total,
           COALESCE(ARRAY_AGG(i.achievement_id ORDER BY i.achievement_id), '{}') AS ids
    FROM   inserted i
    JOIN   eligible e ON e.id = i.achievement_id
  )
  SELECT total, ids
  INTO   v_achievement_coins, out_newly_unlocked
  FROM   coin_totals;

  -- ── Step 5: credit achievement coins ─────────────────────────────────────────
  -- This UPDATE runs after the CTE result is captured in v_achievement_coins.
  -- It is still inside the same transaction as Steps 1–4, so atomicity holds.

  IF v_achievement_coins > 0 THEN
    UPDATE profiles
    SET coins = LEAST(coins::BIGINT + v_achievement_coins, v_int_max)::INTEGER
    WHERE id = p_user_id;

    -- Apply the same cap to the returned value: without this, out_coins could
    -- exceed INTEGER max even when the DB column is correctly bounded.
    out_coins := LEAST(out_coins::BIGINT + v_achievement_coins, v_int_max)::INTEGER;
  END IF;

  -- Guarantee a non-null array: callers can iterate directly without a null check.
  out_newly_unlocked := COALESCE(out_newly_unlocked, ARRAY[]::TEXT[]);

END;
$$;

REVOKE ALL ON FUNCTION save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION save_quiz_session(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER) TO authenticated;
