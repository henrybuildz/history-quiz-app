import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useAuth } from '../../context/AuthContext'
import { Colors, Fonts } from '../../constants/theme'

export default function WelcomeScreen() {
  const router = useRouter()
  const { signInWithGoogle, isAnonymous } = useAuth()

  const handleGoogle = async () => {
    try {
      await signInWithGoogle()
      // Navigation handled by NavigationGuard once session changes
    } catch (err: any) {
      // Google prompt cancelled by user -- no alert needed
      console.log('Google sign-in dismissed:', err.message)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <TouchableOpacity
        style={styles.backButton}
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  backButton: {
    position: 'absolute',
    top: 56,
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
})
