import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react'
import { Alert } from 'react-native'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

declare const __DEV__: boolean

// Supabase Auth error codes for "email already registered".
// These are Auth-server codes — distinct from PostgreSQL SQLSTATE codes
// (e.g. '23505') which only appear in Data client errors, never Auth client errors.
const DUPLICATE_EMAIL_AUTH_CODES = new Set(['email_exists', 'user_already_exists'])

type AuthState = {
  session: Session | null
  user: User | null
  isAnonymous: boolean
  isLoading: boolean
  usernameVersion: number
}

type AuthActions = {
  signInAnonymously: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  linkGoogle: () => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<{ needsVerification: boolean }>
  linkEmail: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  triggerUsernameRefresh: () => void
}

type AuthContextType = AuthState & AuthActions

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [usernameVersion, setUsernameVersion] = useState(0)

  // Monotonically incrementing — NavigationGuard compares against a ref to
  // detect new saves without needing a separate reset signal.
  const triggerUsernameRefresh = useCallback(() => setUsernameVersion(v => v + 1), [])

  // ── Bootstrap: restore persisted session ──────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        // Session load failed (e.g. SecureStore unavailable on device).
        // session stays null — NavigationGuard will route to onboarding.
        // Log in dev so this failure is never invisible during debugging.
        if (__DEV__) console.error('[AuthContext] getSession failed:', err)
        setIsLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setSession(session)
    )

    return () => subscription.unsubscribe()
  }, [])

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInAnonymously = useCallback(async () => {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }, [])

  const signInWithGoogle = useCallback(async () => {
    Alert.alert('Coming Soon', 'Google Sign-In requires a full device build.')
  }, [])

  const linkGoogle = useCallback(async () => {
    Alert.alert('Coming Soon', 'Google Sign-In requires a full device build.')
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUpWithEmail = useCallback(async (
    email: string,
    password: string
  ): Promise<{ needsVerification: boolean }> => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // Supabase returns a session immediately if email confirmation is disabled,
    // or null if it's enabled (user must verify before they can sign in)
    return { needsVerification: !data.session }
  }, [])

  const linkEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.updateUser({ email, password })
    if (error) {
      // Use error.code, not message string-matching — message text is locale-dependent
      // and can change across Supabase versions without notice.
      if (DUPLICATE_EMAIL_AUTH_CODES.has(error.code ?? '')) {
        throw Object.assign(error, { code: 'email_exists' })
      }
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const isAnonymous = session?.user?.is_anonymous ?? false

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        isAnonymous,
        isLoading,
        usernameVersion,
        signInAnonymously,
        signInWithGoogle,
        linkGoogle,
        signInWithEmail,
        signUpWithEmail,
        linkEmail,
        signOut,
        triggerUsernameRefresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
