import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView,
  Platform, Alert, ScrollView
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useAuth } from '../../context/AuthContext'
import { Colors, Fonts } from '../../constants/theme'

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
                placeholder="••••••••"
                placeholderTextColor={Colors.textSecondary}
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
})
