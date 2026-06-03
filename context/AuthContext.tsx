import React, {
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

type AuthState = {
  session: Session | null
  user: User | null
  isAnonymous: boolean
  isLoading: boolean
}

type AuthActions = {
  signInAnonymously: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  linkGoogle: () => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<{ needsVerification: boolean }>
  linkEmail: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

type AuthContextType = AuthState & AuthActions

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // ── Bootstrap: restore persisted session ──────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
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
      // If this email already has an account, route to sign-in instead
      if (error.message.toLowerCase().includes('already')) {
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
        signInAnonymously,
        signInWithGoogle,
        linkGoogle,
        signInWithEmail,
        signUpWithEmail,
        linkEmail,
        signOut,
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
