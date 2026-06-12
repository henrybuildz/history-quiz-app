-- Add DEFAULT values to all non-nullable profile columns.
--
-- Without defaults, upserting { id, username } for a brand-new anonymous user
-- (who has no profile row yet) triggers an INSERT that fails with a NOT NULL
-- constraint violation on total_score, level, xp, lives, and coins.
--
-- BEFORE RUNNING: verify the existing column defaults with:
--   SELECT column_name, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles';
--
-- lives DEFAULT 12: based on app code showing max purchasable hearts = 12.
-- Adjust this value if the intended starting lives differ.
--
-- Safe to re-run: SET DEFAULT always overwrites, never errors on an existing default.

DO $$
BEGIN
  -- Abort early if any of the expected columns are missing, so the caller
  -- knows to investigate rather than silently applying partial defaults.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('total_score', 'level', 'xp', 'lives', 'coins')
    HAVING COUNT(*) = 5
  ) THEN
    RAISE EXCEPTION
      'profiles_column_defaults: one or more expected columns are missing. '
      'Run the pre-flight SELECT above and verify column names before retrying.';
  END IF;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN total_score SET DEFAULT 0,
  ALTER COLUMN level       SET DEFAULT 1,
  ALTER COLUMN xp          SET DEFAULT 0,
  ALTER COLUMN lives       SET DEFAULT 12,
  ALTER COLUMN coins       SET DEFAULT 0;

-- Verify the defaults were applied.
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(column_name, ', ')
  INTO missing
  FROM information_schema.columns
  WHERE table_schema  = 'public'
    AND table_name    = 'profiles'
    AND column_name   IN ('total_score', 'level', 'xp', 'lives', 'coins')
    AND column_default IS NULL;

  IF missing IS NOT NULL THEN
    RAISE WARNING 'profiles_column_defaults: these columns still have no default after migration: %', missing;
  ELSE
    RAISE NOTICE 'profiles_column_defaults: all defaults applied successfully.';
  END IF;
END;
$$;
