import { useEffect } from 'react'
import { useRouter, useSegments } from 'expo-router'
import { useAuth } from './AuthContext'

export function NavigationGuard() {
  const { session, isLoading, isAnonymous, signInAnonymously } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === '(auth)'
    const inTabsGroup = segments[0] === '(tabs)'

    if (!session) {
      // No session at all: silently create anonymous session
      signInAnonymously().catch(() => {
        // Silent anon sign-in failed (no network?): show the welcome screen
        router.replace('/(auth)/welcome')
      })
      return
    }

    // Has a real (non-anonymous) session and is on an auth screen: send to app
    if (inAuthGroup && session?.user?.is_anonymous === false) {
      router.replace('/(tabs)/')
      return
    }

    // Has a session and is nowhere specific (e.g. fresh launch): go to tabs
    if (!inAuthGroup && !inTabsGroup) {
      router.replace('/(tabs)/')
    }
  }, [session, isLoading, segments])

  return null
}
