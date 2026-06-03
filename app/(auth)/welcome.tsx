import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../context/AuthContext'

const GOLD = '#D4A843'
const BG = '#0D0A05'
const MUTED = '#8A7355'

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
  container: { flex: 1, backgroundColor: BG },
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
  backText: { color: MUTED, fontSize: 20 },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 40,
  },
  headerSection: { alignItems: 'center', gap: 16 },
  crownIcon: { fontSize: 48 },
  title: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 28,
    color: GOLD,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: 'Cinzel-Regular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonSection: { gap: 12 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
  },
  googleIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: BG,
  },
  googleText: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 15,
    color: BG,
    letterSpacing: 0.5,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2A2010' },
  dividerText: { fontFamily: 'Cinzel-Regular', fontSize: 12, color: MUTED },
  emailButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GOLD,
    paddingVertical: 16,
    borderRadius: 12,
  },
  emailButtonText: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 15,
    color: GOLD,
    letterSpacing: 0.5,
  },
  createButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#1A1408',
  },
  createButtonText: {
    fontFamily: 'Cinzel-Regular',
    fontSize: 14,
    color: MUTED,
  },
  guestButton: { alignItems: 'center', paddingVertical: 8 },
  guestText: {
    fontFamily: 'Cinzel-Regular',
    fontSize: 12,
    color: '#4A3D2A',
    textDecorationLine: 'underline',
  },
})
