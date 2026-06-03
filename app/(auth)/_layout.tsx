import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_bottom' }}>
      {/* No slide animation: on first launch there's nothing behind onboarding,
          so slide_from_bottom (the stack default) animates against black void. */}
      <Stack.Screen name="onboarding" options={{ animation: 'none' }} />
      <Stack.Screen name="username" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  )
}
