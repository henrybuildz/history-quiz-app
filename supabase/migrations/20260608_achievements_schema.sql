-- Migration: achievements system
--
-- Creates the static achievement catalog and the per-user unlock table.
-- The catalog is seeded once here; the client mirrors it in lib/achievements.ts.
-- Coin rewards are credited inside save_quiz_session_v3 to keep writes atomic.

-- ── Static catalog ────────────────────────────────────────────────────────────

CREATE TABLE achievements (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  icon         TEXT    NOT NULL,
  category     TEXT    NOT NULL CHECK (category IN ('progression','quiz','accuracy','era','score','secret')),
  is_secret    BOOLEAN NOT NULL DEFAULT FALSE,
  reward_coins INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- No RLS on achievements: it is a read-only public catalog. Any authenticated
-- user may read it; no user can modify it (no INSERT/UPDATE/DELETE policy).
-- anon is intentionally excluded — the client-side TS catalog is used for
-- rendering and no unauthenticated code path needs DB access to this table.
GRANT SELECT ON achievements TO authenticated;

-- ── Per-user unlocks ──────────────────────────────────────────────────────────

CREATE TABLE user_achievements (
  user_id        UUID REFERENCES auth.users ON DELETE CASCADE,
  -- RESTRICT prevents silent mass-deletion of unlock history if a catalog row
  -- is ever removed. Removing a catalog entry must explicitly migrate unlock
  -- rows first, surfacing the dependency rather than silently dropping data.
  achievement_id TEXT REFERENCES achievements(id) ON DELETE RESTRICT,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);

-- Per-user lookup used in save_quiz_session (NOT EXISTS guard) and
-- getUnlockedAchievements (profile screen load).
CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- authenticated covers both signed-in and anonymous Supabase users.
GRANT SELECT ON user_achievements TO authenticated;

CREATE POLICY "users read own achievements"
  ON user_achievements FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT is handled exclusively via save_quiz_session (SECURITY DEFINER).
-- Omitting a client INSERT policy is intentional: prevents self-awarding.

-- ── Performance indexes on quiz_sessions ─────────────────────────────────────
-- The achievement eligibility CTE issues multiple correlated subqueries against
-- quiz_sessions. These two indexes cover every predicate used:
--   (user_id)      — COUNT(*), accuracy SUM, COUNT(DISTINCT era)
--   (user_id, era) — per-era counts (era_rome, era_egypt, era_ww2, ancients, wartime)
--
-- IF NOT EXISTS checks by index NAME, not column coverage. The names below follow
-- the project's idx_<table>_<columns> convention; if an index with a different
-- name already covers these columns, remove the conflicting CREATE below.
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_id
  ON quiz_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_era
  ON quiz_sessions(user_id, era);

-- ── Seed the catalog ──────────────────────────────────────────────────────────

INSERT INTO achievements (id, name, description, icon, category, is_secret, reward_coins, sort_order) VALUES
  -- Progression
  ('level_2',      'Apprentice',          'Reach level 2',                                    '📜', 'progression', FALSE,  25, 10),
  ('level_5',      'Scholar',             'Reach level 5',                                    '🎓', 'progression', FALSE,  30, 11),
  ('level_10',     'Historian',           'Reach level 10',                                   '📚', 'progression', FALSE, 150, 12),
  ('level_20',     'Grand Archivist',     'Reach level 20',                                   '🏛', 'progression', FALSE, 300, 13),
  -- Quiz count
  ('quiz_1',       'First Chronicle',     'Complete your first quiz',                         '✍️', 'quiz',        FALSE,  10, 20),
  ('quiz_10',      'Diligent Student',    'Complete 10 quizzes',                              '🔟', 'quiz',        FALSE,  50, 21),
  ('quiz_50',      'History Buff',        'Complete 50 quizzes',                              '📖', 'quiz',        FALSE, 150, 22),
  ('quiz_100',     'Living Encyclopedia', 'Complete 100 quizzes',                             '📕', 'quiz',        FALSE, 300, 23),
  -- Accuracy / skill
  ('perfect_1',    'Flawless',            'Finish a quiz without a wrong answer',             '💎', 'accuracy',    FALSE,  75, 30),
  ('perfect_5',    'Untouchable',         'Finish 5 perfect quizzes',                         '🏆', 'accuracy',    FALSE, 200, 31),
  ('streak_5',     'On a Roll',           '5 correct answers in a row in one quiz',           '🔥', 'accuracy',    FALSE,  30, 32),
  ('streak_10',    'Hot Streak',          '10 correct answers in a row in one quiz',          '⚡', 'accuracy',    FALSE,  75, 33),
  ('accuracy_90',  'Sharp Mind',          'Achieve 90%+ accuracy across 10+ quizzes',         '🎯', 'accuracy',    FALSE, 100, 34),
  -- Score milestones
  ('score_1k',     'Bronze Annals',       'Reach 1,000 total score',                          '🥉', 'score',       FALSE,  25, 40),
  ('score_10k',    'Silver Annals',       'Reach 10,000 total score',                         '🥈', 'score',       FALSE,  75, 41),
  ('score_50k',    'Gold Annals',         'Reach 50,000 total score',                         '🥇', 'score',       FALSE, 200, 42),
  ('score_100k',   'Legendary',           'Reach 100,000 total score',                        '👑', 'score',       FALSE, 400, 43),
  -- Era mastery
  ('era_rome',     'Roman Senator',       'Complete 3 Ancient Rome quizzes',                  '🏟', 'era',         FALSE,  50, 50),
  ('era_egypt',    'Pharaoh''s Pupil',    'Complete 3 Ancient Egypt quizzes',                 '🔱', 'era',         FALSE,  50, 51),
  ('era_ww2',      'War Correspondent',   'Complete 3 World War II quizzes',                  '🎖', 'era',         FALSE,  50, 52),
  ('era_10',       'Global Scholar',      'Play quizzes in 10 different eras',                '🌍', 'era',         FALSE, 100, 53),
  ('era_all',      'Omniscient',          'Play at least one quiz in every era',              '🌐', 'era',         FALSE, 500, 54),
  -- Secret / hidden
  ('ancients',     'Voice of Antiquity',  'Complete quizzes in Rome, Greece & Egypt',         '🗿', 'secret',      TRUE,  100, 60),
  ('wartime',      'The Great Wars',      'Complete quizzes in both World Wars',              '⚔️', 'secret',      TRUE,  100, 61),
  ('iron_will',    'Last Gasp',           'Finish a quiz on your final life',                 '❤️', 'secret',      TRUE,   75, 62),
  ('dawn_of_time', 'Dawn of Time',        'Play Early Civilizations as your very first quiz', '🌅', 'secret',      TRUE,   50, 63);
