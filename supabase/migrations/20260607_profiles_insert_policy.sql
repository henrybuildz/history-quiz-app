-- Allow authenticated users (including anonymous) to insert their own profile row.
--
-- The existing "Profile insert by trigger only" policy was designed for a setup
-- where a DB trigger creates profile rows on auth.users INSERT. That trigger
-- either doesn't fire for anonymous users or doesn't exist, leaving anonymous
-- users with no profile row. When they try to save a username, the upsert's
-- INSERT path is blocked by the existing policy.
--
-- This policy adds the missing permission. If the existing INSERT policy is
-- RESTRICTIVE (AS RESTRICTIVE) rather than permissive, this won't be enough —
-- run the diagnostic query first and drop the restrictive policy if needed.

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);
