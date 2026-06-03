import { useEffect, useRef } from 'react'
import { useRouter, useSegments } from 'expo-router'
import { useAuth } from './AuthContext'

export function NavigationGuard() {
  const { session, isLoading, signInAnonymously } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  const signingInAnon = useRef(false)

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(auth)'

    if (!session) {
      // User is already in the auth flow — let them proceed without
      // interruption. Attempting anon sign-in here would hijack navigation
      // on every auth-screen transition when there is no network.
      if (inAuthGroup) return

      if (signingInAnon.current) return
      signingInAnon.current = true
      signInAnonymously()
        .catch(() => {
          // No network and not already in auth — send to welcome as fallback.
          router.replace('/(auth)/welcome')
        })
        .finally(() => {
          signingInAnon.current = false
        })
      return
    }

    // session is non-null past this point.
    // !==  true is intentional: is_anonymous is boolean | undefined in the
    // Supabase User type; this redirects only confirmed real users.
    if (inAuthGroup && session.user.is_anonymous !== true) {
      router.replace('/(tabs)/')
    }
  }, [session, isLoading, segments, signInAnonymously, router])

  return null
}
