import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, KeyboardAvoidingView,
  Platform, Alert, ScrollView
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../context/AuthContext'

const GOLD = '#D4A843'
const BG = '#0D0A05'
const CARD_BG = '#1A1408'
const MUTED = '#8A7355'
const BORDER = '#2A2010'
const TEXT = '#E8D5B0'
const GREEN = '#4A8C5C'

export default function SignUpScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const { signUpWithEmail } = useAuth()
  const router = useRouter()

  const handleSubmit = async () => {
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

    setLoading(true)
    try {
      const { needsVerification } = await signUpWithEmail(trimmedEmail, password)
      if (needsVerification) {
        setDone(true)
        // NavigationGuard will route to (tabs) automatically if session returns
      }
      // If no verification needed (email confirm disabled), session fires via
      // onAuthStateChange and NavigationGuard routes automatically
    } catch (err: any) {
      Alert.alert('Sign Up Failed', err.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.doneContent}>
          <Text style={styles.doneIcon}>📜</Text>
          <Text style={styles.doneTitle}>Check Your Email</Text>
          <Text style={styles.doneSubtitle}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.doneEmail}>{email.trim()}</Text>
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
                placeholderTextColor="#4A3D2A"
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
                placeholderTextColor="#4A3D2A"
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
                placeholderTextColor="#4A3D2A"
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
  container: { flex: 1, backgroundColor: BG },
  content: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
    paddingBottom: 40,
    gap: 32,
  },
  backButton: { alignSelf: 'flex-start' },
  backText: { fontFamily: 'Cinzel-Regular', fontSize: 14, color: MUTED },
  headerSection: { gap: 10 },
  title: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 26,
    color: GOLD,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: 'Cinzel-Regular',
    fontSize: 13,
    color: MUTED,
    lineHeight: 20,
  },
  form: { gap: 20 },
  fieldGroup: { gap: 8 },
  label: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 10,
    color: MUTED,
    letterSpacing: 2,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: TEXT,
    fontFamily: 'Cinzel-Regular',
    fontSize: 15,
  },
  submitButton: {
    backgroundColor: GOLD,
    paddingVertical: 17,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitDisabled: { opacity: 0.55 },
  submitText: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 15,
    color: BG,
    letterSpacing: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  footerText: { fontFamily: 'Cinzel-Regular', fontSize: 13, color: MUTED },
  footerLink: { fontFamily: 'Cinzel-Bold', fontSize: 13, color: GOLD },
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
    fontFamily: 'Cinzel-Bold',
    fontSize: 24,
    color: GOLD,
    letterSpacing: 1,
  },
  doneSubtitle: {
    fontFamily: 'Cinzel-Regular',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneEmail: { color: TEXT },
  doneButton: {
    marginTop: 8,
    backgroundColor: GOLD,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
  doneButtonText: {
    fontFamily: 'Cinzel-Bold',
    fontSize: 15,
    color: BG,
    letterSpacing: 1,
  },
})

