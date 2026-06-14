import { useEffect, useRef } from 'react'
import { useRouter, useSegments } from 'expo-router'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'

declare const __DEV__: boolean

type UsernameCache = { userId: string; username: string | null }

export function NavigationGuard() {
  const { session, isLoading, usernameVersion, didLogOut, isSigningOut } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  const usernameCache = useRef<UsernameCache | null>(null)
  const prevSegments = useRef<string[]>([])
  // Tracks the last usernameVersion processed. When usernameVersion is higher,
  // a save just completed and the cache must be cleared before checkAndRoute.
  // A ref (not state) means the comparison and clear happen synchronously in
  // the same effect run — no secondary render, no cleanup cancelling the query.
  const lastProcessedVersion = useRef(0)

  useEffect(() => {
    // Version check is unconditional: it is a cache-management concern
    // independent of isLoading, and must run before any early return so that
    // lastProcessedVersion is always up-to-date when the next run fires.
    const versionAdvanced = usernameVersion > lastProcessedVersion.current
    if (versionAdvanced) {
      lastProcessedVersion.current = usernameVersion
      usernameCache.current = null
    }

    if (isLoading) return

    let cancelled = false

    const segs = segments as string[]
    const inAuthGroup = segs[0] === '(auth)'
    const currentAuthPage: string | null = inAuthGroup ? (segs[1] ?? null) : null

    // Defensive fallback: invalidate cache when navigating away from the
    // username screen without a save signal (e.g. hardware back button,
    // deep-link, multi-device username change). Skipped when the version
    // counter already cleared the cache this run, preventing a redundant
    // DB query on the segment-change effect that follows a successful save.
    if (!versionAdvanced) {
      const prevSegs = prevSegments.current
      const wasOnUsername = prevSegs[0] === '(auth)' && prevSegs[1] === 'username'
      if (wasOnUsername && currentAuthPage !== 'username') {
        usernameCache.current = null
      }
    }
    prevSegments.current = segs

    if (!session) {
      // didLogOut: user explicitly tapped Log Out → stay in tabs as local guest.
      // isSigningOut: sign-out in flight; don't redirect before SIGNED_OUT fires.
      // Without either: brand-new user with no session → send to onboarding.
      if (!inAuthGroup && !didLogOut && !isSigningOut) {
        router.replace('/(auth)/onboarding')
      }
      return
    }

    const userId = session.user.id

    const checkAndRoute = async (triggeredByVersionAdvance: boolean) => {
      if (cancelled) return
      let username: string | null = null

      if (usernameCache.current?.userId === userId) {
        username = usernameCache.current.username
      } else {
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', userId)
          .single()
        if (cancelled) return
        // PGRST116 = no rows — new user has no profile yet, treat as no username
        if (error && error.code !== 'PGRST116') return
        const row = data as { username: string | null } | null
        username = row?.username ?? null
        usernameCache.current = { userId, username }
      }

      if (cancelled) return

      if (!username) {
        // Skip auto-routing from 'welcome' — the success modal handles navigation
        // after sign-in so it has time to display before being dismissed.
        if (currentAuthPage !== 'username' && currentAuthPage !== 'welcome') {
          router.replace('/(auth)/username')
        }
      } else {
        // Only redirect away from onboarding/username — not from sign-in or
        // sign-up, where the user may be in the middle of an account-linking
        // flow. Anonymous users are included: once they have a username they
        // should proceed to the app (they can link their account from the
        // profile screen).
        //
        // Never redirect away from the username screen unless the user just
        // saved a username (triggeredByVersionAdvance). Without this guard,
        // a background DB query that finds an existing username (e.g. from a
        // returning anonymous user or a DB trigger that auto-assigns one) would
        // kick the user off the username screen before they can type anything.
        //
        // Contract: triggerUsernameRefresh() must ONLY be called after a
        // successful username save. Calling it for other reasons (e.g. cache
        // busting) will advance the version counter and auto-route users away
        // from the username screen mid-typing.
        const safeToRedirect =
          currentAuthPage === 'onboarding' ||
          (currentAuthPage === 'username' && triggeredByVersionAdvance)
        if (inAuthGroup && safeToRedirect) {
          router.replace('/(tabs)/')
        }
      }
    }

    checkAndRoute(versionAdvanced).catch((err) => {
      if (__DEV__) console.error('[NavigationGuard] checkAndRoute error:', err)
    })

    return () => {
      cancelled = true
    }
  }, [session, isLoading, segments, router, usernameVersion, didLogOut, isSigningOut])

  return null
}
