import { useRef, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView,
  Platform, Alert, ScrollView
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useAuth } from '../../context/AuthContext'
import { Colors, Fonts } from '../../constants/theme'

export default function SignUpScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')
  const loadingRef = useRef(false)
  const { signUpWithEmail } = useAuth()
  const router = useRouter()

  const handleSubmit = async () => {
    if (loadingRef.current) return
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password || !confirm) {
      Alert.alert('Missing Fields', 'Please fill in all fields.')
      return
    }
    if (password !== confirm) {
      Alert.alert('Password Mismatch', 'Your passwords do not match.')
      return
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.')
      return
    }

    loadingRef.current = true
    setLoading(true)
    try {
      const { needsVerification } = await signUpWithEmail(trimmedEmail, password)
      if (needsVerification) {
        setSubmittedEmail(trimmedEmail)
        setDone(true)
        return
      }
    } catch (err: unknown) {
      const code = (err as Record<string, unknown>)?.code
      if (code === 'email_exists' || code === 'user_already_exists') {
        Alert.alert(
          'Account Already Exists',
          'An account with this email already exists.',
          [{ text: 'Sign In', onPress: () => router.replace('/(auth)/sign-in') }],
        )
      } else {
        const message = err instanceof Error ? err.message : 'Something went wrong.'
        Alert.alert('Sign Up Failed', message)
      }
      return
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
    // Navigation outside try/catch — router errors won't appear as auth errors.
    router.replace('/(tabs)/')
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.doneContent}>
          <Text style={styles.doneIcon}>📜</Text>
          <Text style={styles.doneTitle}>Check Your Email</Text>
          <Text style={styles.doneSubtitle}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.doneEmail}>{submittedEmail}</Text>
            {'\n\n'}Click the link to activate your account.
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.replace('/(auth)/sign-in')}
            activeOpacity={0.85}
          >
            <Text style={styles.doneButtonText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.headerSection}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Join the ranks of History Quiz scholars and compete globally.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>EMAIL</Text>
              <TextInput
                style={styles.input}
                placeholder="historian@example.com"
                placeholderTextColor={Colors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>PASSWORD</Text>
              <TextInput
                style={styles.input}
                placeholder="Min. 6 characters"
                placeholderTextColor={Colors.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>CONFIRM PASSWORD</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={Colors.textSecondary}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.submitText}>
                {loading ? 'Creating Account…' : 'Create Account'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/sign-in')}>
              <Text style={styles.footerLink}> Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  content: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
    paddingBottom: 40,
    gap: 32,
  },
  backButton: { alignSelf: 'flex-start' },
  backText: { fontFamily: Fonts.display, fontSize: 14, color: Colors.textMuted },
  headerSection: { gap: 10 },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.gold,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: Fonts.display,
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  form: { gap: 20 },
  fieldGroup: { gap: 8 },
  label: {
    fontFamily: Fonts.displayBold,
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: Colors.textPrimary,
    fontFamily: Fonts.display,
    fontSize: 15,
  },
  submitButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 17,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitDisabled: { opacity: 0.55 },
  submitText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.bg,
    letterSpacing: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  footerText: { fontFamily: Fonts.display, fontSize: 13, color: Colors.textMuted },
  footerLink: { fontFamily: Fonts.displayBold, fontSize: 13, color: Colors.gold },
  // Done state
  doneContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 20,
  },
  doneIcon: { fontSize: 56 },
  doneTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 24,
    color: Colors.gold,
    letterSpacing: 1,
  },
  doneSubtitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneEmail: { color: Colors.textPrimary },
  doneButton: {
    marginTop: 8,
    backgroundColor: Colors.gold,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
  doneButtonText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.bg,
    letterSpacing: 1,
  },
})
