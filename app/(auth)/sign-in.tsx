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

export default function SignInScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { signInWithEmail } = useAuth()
  const router = useRouter()

  const handleSubmit = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.')
      return
    }
    // indexOf/lastIndexOf: exactly one '@', with non-empty local and domain parts.
    // split('@') destructuring silently discards extra segments, so 'a@b@c'
    // would pass a simple [localPart, domain] check — hence the explicit check here.
    const atIdx = trimmedEmail.indexOf('@')
    const validEmail =
      atIdx > 0 &&
      atIdx === trimmedEmail.lastIndexOf('@') &&
      atIdx < trimmedEmail.length - 1
    if (!validEmail) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.')
      return
    }

    setLoading(true)
    try {
      await signInWithEmail(trimmedEmail, password)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      Alert.alert('Sign In Failed', message)
    } finally {
      setLoading(false)
    }
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
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Sign in to your History Quiz account.</Text>
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
                placeholder="••••••••"
                placeholderTextColor="#4A3D2A"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
                textContentType="password"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.submitText}>
                {loading ? 'Signing in…' : 'Sign In'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/sign-up')}>
              <Text style={styles.footerLink}> Create one</Text>
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
})
