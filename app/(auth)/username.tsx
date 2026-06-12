import { useCallback, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { validateUsername } from '../../lib/validation'
import { extractErrorMessage } from '../../lib/errors'
import { Colors, Fonts } from '../../constants/theme'

export default function UsernameScreen() {
  const { user, triggerUsernameRefresh } = useAuth()
  const inputRef = useRef<TextInput>(null)
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const usernameRef = useRef('')
  // Mirrors loading state so handleConfirm is stable (no loading in deps).
  // Without this, loading in deps forces handleConfirm to rebuild on every
  // loading transition, re-propping TextInput.onSubmitEditing each time.
  const loadingRef = useRef(false)
  // Controls when live validation activates — only after the first submit attempt,
  // so errors don't appear while the user is still typing for the first time.
  const hasSubmittedRef = useRef(false)

  // Extract stable primitive — the User object reference changes on every token
  // rotation even when the ID is unchanged; using userId as a dep prevents
  // handleConfirm from rebuilding on silent background token refreshes.
  const userId = user?.id

  useFocusEffect(
    useCallback(() => {
      // Full symmetric reset: error, submission gate, and input value all reset
      // together. A partial reset (only error + flag, not value) left stale text
      // in the input with no error shown — the worst state for a returning user.
      hasSubmittedRef.current = false
      usernameRef.current     = ''
      setUsername('')
      setError(null)
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }, []),
  )

  // setUsername and setError are stable useState setters — React guarantees they
  // never change. Including them satisfies exhaustive-deps without any cost.
  const handleChange = useCallback((value: string) => {
    usernameRef.current = value
    setUsername(value)
    if (hasSubmittedRef.current) setError(validateUsername(value.trim()))
  }, [setUsername, setError])

  // Stable — loading and username accessed via refs, not state deps.
  const handleConfirm = useCallback(async () => {
    if (loadingRef.current) return

    // Set before the early-return so live validation activates even when the
    // first submit attempt fails validation.
    hasSubmittedRef.current = true

    const currentUsername = usernameRef.current.trim()
    const validationError = validateUsername(currentUsername)
    if (validationError) {
      setError(validationError)
      return
    }

    if (!userId) {
      Alert.alert('Session Expired', 'Please restart the app and try again.')
      return
    }

    loadingRef.current = true
    setLoading(true)
    try {
      const { error: dbError } = await supabase
        .from('profiles')
        .upsert({ id: userId, username: currentUsername }, { onConflict: 'id' })
      if (dbError) {
        if (dbError.code === '23505') {
          setError('That username is already taken')
          return
        }
        throw dbError
      }
      triggerUsernameRefresh()
    } catch (err: unknown) {
      Alert.alert('Error', extractErrorMessage(err, 'Could not save username'))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [userId, triggerUsernameRefresh])

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* 'padding' adds bottom padding equal to the keyboard height on both
          platforms, preserving the centred layout. 'height' shrinks the view
          on Android and breaks justifyContent:'center'. */}
      <KeyboardAvoidingView style={styles.keyboardView} behavior="padding">
        <View style={styles.content}>
          <Text style={styles.title}>Choose Your Name</Text>
          <Text style={styles.subtitle}>This is how you'll appear in the app</Text>

          <View style={styles.inputWrapper}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Enter username"
              placeholderTextColor={Colors.textMuted}
              value={username}
              onChangeText={handleChange}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
            />
            {error !== null && <Text style={styles.errorText}>{error}</Text>}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConfirm}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.bg} />
            ) : (
              <Text style={styles.buttonText}>Confirm</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  keyboardView: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 24,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: Colors.gold,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: -8,
  },
  inputWrapper: { gap: 8 },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  errorText: {
    fontFamily: Fonts.display,
    fontSize: 12,
    color: Colors.gold,
    paddingLeft: 4,
  },
  button: {
    backgroundColor: Colors.gold,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.bg,
    letterSpacing: 0.5,
  },
})
