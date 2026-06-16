import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react'
import { Platform } from 'react-native'
import { Session, User } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase, resetGuestHeartsInit, clearGuestHearts } from '../lib/supabase'
import { clearGuestSnapshot } from '../lib/guestSnapshot'

// Required for OAuth browser sessions to complete on iOS.
WebBrowser.maybeCompleteAuthSession()

const DID_LOG_OUT_KEY = 'did_log_out'

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
  didLogOut: boolean
  isSigningOut: boolean
}

type AuthActions = {
  signInAnonymously: () => Promise<void>
  signInWithGoogle: () => Promise<boolean>
  signInWithApple: () => Promise<void>
  linkGoogle: () => Promise<boolean>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<{ needsVerification: boolean }>
  linkEmail: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  triggerUsernameRefresh: () => void
}

type AuthContextType = AuthState & AuthActions

const AuthContext = createContext<AuthContextType | null>(null)

// Parses access_token + refresh_token from the OAuth callback URL fragment
// and sets the Supabase session. The Supabase project uses implicit flow so
// tokens arrive in the URL fragment (#access_token=...&refresh_token=...).
async function _setSessionFromOAuthUrl(url: string) {
  const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1] ?? ''
  const params = new URLSearchParams(fragment)
  const accessToken  = params.get('access_token')  ?? ''
  const refreshToken = params.get('refresh_token') ?? ''
  if (!accessToken) return { error: new Error('Google sign-in failed: no access token in callback') }
  return supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [usernameVersion, setUsernameVersion] = useState(0)
  const [didLogOut, setDidLogOut] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Monotonically incrementing — NavigationGuard compares against a ref to
  // detect new saves without needing a separate reset signal.
  const triggerUsernameRefresh = useCallback(() => setUsernameVersion(v => v + 1), [])

  // ── Bootstrap: restore persisted session ──────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.auth.getSession(),
      SecureStore.getItemAsync(DID_LOG_OUT_KEY).catch(() => null),
    ])
      .then(([{ data: { session } }, savedFlag]) => {
        // Restore guest-mode flag so NavigationGuard skips onboarding after a
        // cold restart that follows an explicit logout.
        if (!session && savedFlag === '1') setDidLogOut(true)
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
      (event, session) => {
        if (event === 'SIGNED_IN') {
          // Reset guest-mode flag for ALL sign-ins (including anonymous) so
          // didLogOut is never left stale after a "Continue as Guest" tap.
          setDidLogOut(false)
          SecureStore.deleteItemAsync(DID_LOG_OUT_KEY).catch(() => {})
          if (session?.user && !session.user.is_anonymous) {
            clearGuestSnapshot()
            clearGuestHearts()
          }
        }
        if (event === 'SIGNED_OUT') {
          resetGuestHeartsInit()
        }
        setSession(session)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInAnonymously = useCallback(async () => {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }, [])

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    const redirectTo = Linking.createURL('/')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error) throw error
    if (!data.url) throw new Error('No OAuth URL returned from Supabase')
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
    if (result.type !== 'success') return false
    const { error: sessionError } = await _setSessionFromOAuthUrl(result.url)
    if (sessionError) throw sessionError
    return true
  }, [])

  const signInWithApple = useCallback(async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
    if (!credential.identityToken) throw new Error('Apple sign-in returned no identity token')
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    })
    if (error) throw error
  }, [])

  const linkGoogle = useCallback(async (): Promise<boolean> => {
    const redirectTo = Linking.createURL('/')
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error) throw error
    if (!data.url) throw new Error('No OAuth URL returned from Supabase')
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
    if (result.type !== 'success') return false
    const { error: sessionError } = await _setSessionFromOAuthUrl(result.url)
    if (sessionError) throw sessionError
    return true
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
    // isSigningOut set synchronously so NavigationGuard's !session branch never
    // fires between the setDidLogOut render and the SIGNED_OUT onAuthStateChange.
    setIsSigningOut(true)
    setDidLogOut(true)
    await SecureStore.setItemAsync(DID_LOG_OUT_KEY, '1').catch(() => {})
    const { error } = await supabase.auth.signOut()
    if (error) {
      setIsSigningOut(false)
      setDidLogOut(false)
      SecureStore.deleteItemAsync(DID_LOG_OUT_KEY).catch(() => {})
      throw error
    }
    setIsSigningOut(false)
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
        didLogOut,
        isSigningOut,
        signInAnonymously,
        signInWithGoogle,
        signInWithApple,
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
