import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Alert, Modal, ActivityIndicator,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { Colors, Fonts } from '../../constants/theme'

export default function WelcomeScreen() {
  const router = useRouter()
  const { signInWithGoogle, signInWithApple, linkGoogle, isAnonymous } = useAuth()
  const insets = useSafeAreaInsets()
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [doneLoading, setDoneLoading] = useState(false)

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {})
  }, [])

  const handleGoogle = useCallback(async () => {
    try {
      // Anonymous users link their identity so guest progress is preserved.
      // Non-anonymous users (re-login) create a fresh session via signInWithGoogle.
      const signedIn = await (isAnonymous ? linkGoogle() : signInWithGoogle())
      if (!signedIn) return  // user cancelled the browser sheet
      setShowSuccess(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Sign-in error', msg)
    }
  }, [signInWithGoogle, linkGoogle, isAnonymous])

  const handleApple = useCallback(async () => {
    try {
      await signInWithApple()
      setShowSuccess(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // ERR_REQUEST_CANCELED = user dismissed the Apple sheet
      if (msg.includes('ERR_REQUEST_CANCELED')) return
      console.log('Apple sign-in error:', msg)
      Alert.alert('Sign-in failed', 'Could not sign in with Apple. Please try again.')
    }
  }, [signInWithApple])

  const handleSuccessDone = useCallback(async () => {
    if (doneLoading) return
    setDoneLoading(true)
    try {
      // Read the user directly from Supabase rather than from React state, which
      // may lag behind because onAuthStateChange fires asynchronously after sign-in.
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) {
        setShowSuccess(false)
        router.replace('/(auth)/username')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', currentUser.id)
        .single()
      setShowSuccess(false)
      if (data?.username) {
        router.replace('/(tabs)/profile')
      } else {
        router.replace('/(auth)/username')
      }
    } catch {
      setShowSuccess(false)
      router.replace('/(auth)/username')
    } finally {
      setDoneLoading(false)
    }
  }, [doneLoading, router])

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 12 }]}
        onPress={() => router.back()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.backText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.crownIcon}>👑</Text>
          <Text style={styles.title}>Save Your Legacy</Text>
          <Text style={styles.subtitle}>
            {isAnonymous
              ? 'Your guest progress is local. Sign in to appear on the leaderboard and never lose your score.'
              : 'Sign in to your account to continue.'}
          </Text>
        </View>

        {/* Auth buttons */}
        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={styles.googleButton}
            onPress={handleGoogle}
            activeOpacity={0.8}
          >
            <Text style={styles.googleIcon}>G</Text>
            <Text style={styles.googleText}>Continue with Google</Text>
          </TouchableOpacity>

          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={styles.appleButton}
              onPress={handleApple}
            />
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.emailButton}
            onPress={() => router.push('/(auth)/sign-in')}
            activeOpacity={0.8}
          >
            <Text style={styles.emailButtonText}>Sign in with Email</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/(auth)/sign-up')}
            activeOpacity={0.8}
          >
            <Text style={styles.createButtonText}>Create an Account</Text>
          </TouchableOpacity>
        </View>

        {/* Guest continue */}
        {isAnonymous && (
          <TouchableOpacity
            style={styles.guestButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Text style={styles.guestText}>Continue as Guest</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={showSuccess} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay}>
          <View style={styles.successCard}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
            <Text style={styles.successTitle}>You're all signed in!</Text>
            <Text style={styles.successSubtitle}>Welcome to History Quiz</Text>
            <TouchableOpacity
              style={[styles.doneButton, doneLoading && styles.doneButtonDisabled]}
              onPress={handleSuccessDone}
              activeOpacity={0.8}
              disabled={doneLoading}
            >
              {doneLoading
                ? <ActivityIndicator color={Colors.bg} />
                : <Text style={styles.doneButtonText}>Done</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  backButton: {
    position: 'absolute',
    right: 24,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: Colors.textMuted, fontSize: 20 },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 40,
  },
  headerSection: { alignItems: 'center', gap: 16 },
  crownIcon: { fontSize: 48 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.gold,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: Fonts.display,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonSection: { gap: 12 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
  },
  appleButton: {
    height: 52,
    width: '100%',
  },
  googleIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.bg,
  },
  googleText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.bg,
    letterSpacing: 0.5,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontFamily: Fonts.display, fontSize: 12, color: Colors.textMuted },
  emailButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.gold,
    paddingVertical: 16,
    borderRadius: 12,
  },
  emailButtonText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  createButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
  },
  createButtonText: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textMuted,
  },
  guestButton: { alignItems: 'center', paddingVertical: 8 },
  guestText: {
    fontFamily: Fonts.display,
    fontSize: 12,
    color: Colors.textSecondary,
    textDecorationLine: 'underline',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingVertical: 40,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    gap: 16,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.correct,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  checkMark: {
    fontSize: 36,
    color: '#FFFFFF',
    lineHeight: 40,
  },
  successTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 20,
    color: Colors.gold,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  successSubtitle: {
    fontFamily: Fonts.display,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  doneButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minWidth: 140,
    height: 48,
  },
  doneButtonDisabled: { opacity: 0.7 },
  doneButtonText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.bg,
    letterSpacing: 0.5,
  },
})
