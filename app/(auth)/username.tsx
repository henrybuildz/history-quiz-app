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
import { Colors, Fonts } from '../../constants/theme'

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

function validate(value: string): string | null {
  if (value.length < 3) return 'Username must be at least 3 characters'
  if (value.length > 20) return 'Username must be 20 characters or less'
  if (!USERNAME_REGEX.test(value)) return 'Only letters, numbers, and underscores'
  return null
}

// Supabase PostgrestError does not extend Error, so instanceof Error is false.
// This helper extracts .message from any throwable shape.
function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as Record<string, unknown>).message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  return 'An unexpected error occurred'
}

export default function UsernameScreen() {
  const { user, triggerUsernameRefresh } = useAuth()
  const inputRef = useRef<TextInput>(null)
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // useFocusEffect fires after the screen transition animation completes,
  // which is precisely when keyboard focus should appear. A hardcoded
  // setTimeout(350) guesses the animation duration and breaks when it changes
  // (e.g. reduced-motion accessibility setting, future Expo animation changes).
  // The 50 ms delay gives the native layout pass time to settle.
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }, []),
  )

  const handleChange = (value: string) => {
    setUsername(value)
    // Re-validate live only after the first failed submit attempt, so errors
    // don't appear before the user has had a chance to type anything
    if (error !== null) setError(validate(value))
  }

  const handleConfirm = async () => {
    // Guard against double-submit: TouchableOpacity.disabled doesn't block
    // the keyboard's "Done" key from firing onSubmitEditing
    if (loading) return

    const validationError = validate(username)
    if (validationError) {
      setError(validationError)
      return
    }

    if (!user) {
      Alert.alert('Session Expired', 'Please restart the app and try again.')
      return
    }

    setLoading(true)
    try {
      // upsert instead of update: update() is a silent no-op when no row
      // exists yet, causing an infinite NavigationGuard redirect loop.
      // upsert inserts a new row or updates username on an existing one.
      const { error: dbError } = await supabase
        .from('profiles')
        .upsert({ id: user.id, username })
      if (dbError) {
        // 23505 = PostgreSQL unique_violation. Show a readable message instead
        // of the raw constraint name that Supabase returns verbatim.
        if (dbError.code === '23505') {
          setError('That username is already taken')
          return
        }
        throw dbError
      }
      triggerUsernameRefresh()
    } catch (err: unknown) {
      Alert.alert('Error', extractMessage(err))
    } finally {
      setLoading(false)
    }
  }

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
