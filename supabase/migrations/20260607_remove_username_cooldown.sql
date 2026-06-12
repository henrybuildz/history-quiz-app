-- Remove the 14-day username change cooldown trigger and its backing function.
--
-- STATUS: Applied manually via SQL editor on 2026-06-07. The trigger was
-- confirmed dropped; the only remaining trigger on profiles is
-- `profiles_updated_at` (BEFORE UPDATE — sets updated_at timestamp, safe to keep).
--
-- This file is kept as a migration record. Re-running it is safe (IF EXISTS),
-- and will RAISE WARNING if the patterns no longer match anything — which is
-- the expected outcome after a successful first run.
--
-- If Supabase CLI migration tracking is ever introduced, register this file's
-- checksum as already-applied to prevent a spurious re-run.

DO $$
DECLARE
  r       RECORD;
  dropped INTEGER := 0;
BEGIN
  FOR r IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table  = 'profiles'
      AND trigger_name != 'profiles_updated_at'  -- intentionally kept: standard maintenance trigger, not a cooldown
      AND (
        lower(trigger_name) LIKE '%username%'   OR
        lower(trigger_name) LIKE '%cooldown%'   OR
        lower(trigger_name) LIKE '%rate_limit%' OR
        lower(trigger_name) LIKE '%rate%limit%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.profiles', r.trigger_name);
    RAISE NOTICE 'Dropped trigger: %', r.trigger_name;
    dropped := dropped + 1;
  END LOOP;

  IF dropped = 0 THEN
    RAISE WARNING
      'remove_username_cooldown: no matching trigger found on public.profiles. '
      'If this is a first run, the trigger name did not match the search patterns. '
      'Run: SELECT trigger_name FROM information_schema.triggers '
      'WHERE event_object_table = ''profiles'' AND event_object_schema = ''public'' '
      'to inspect manually. If this migration already ran successfully, ignore this warning.';
  END IF;
END;
$$;

DO $$
DECLARE
  r       RECORD;
  dropped INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.proname
    FROM pg_proc     p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname   = 'public'
      AND p.prorettype = (SELECT oid FROM pg_type WHERE typname = 'trigger')
      AND (
        lower(p.proname) LIKE '%username%'   OR
        lower(p.proname) LIKE '%cooldown%'   OR
        lower(p.proname) LIKE '%rate_limit%' OR
        lower(p.proname) LIKE '%rate%limit%'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I() CASCADE', r.proname);
    RAISE NOTICE 'Dropped function: %', r.proname;
    dropped := dropped + 1;
  END LOOP;

  IF dropped = 0 THEN
    RAISE WARNING
      'remove_username_cooldown: no matching trigger function found. '
      'Either already dropped, or named outside the search pattern.';
  END IF;
END;
$$;
