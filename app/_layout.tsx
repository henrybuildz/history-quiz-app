import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Colors } from '../constants/theme';
import { AuthProvider } from '../context/AuthContext';
import { NavigationGuard } from '../context/NavigationGuard';
import { AchievementToast } from '../components/AchievementToast';
import { initGuestHearts } from '../lib/supabase';

// Explicit declaration removes the implicit assumption that __DEV__ is globally
// typed. In Expo SDK 56 + @types/react-native it always is, but being explicit
// is self-documenting and safe across TypeScript config variations.
declare const __DEV__: boolean;

SplashScreen.preventAutoHideAsync();

// retry: 1 -- fail fast on mobile; UI error states handle the feedback
// staleTime: 30s -- prevents unnecessary Supabase calls on every tab switch;
//   individual queries override this where tighter freshness is needed
// gcTime: 10min -- keep cached data alive longer to survive background/foreground
//   cycles on mobile. NOTE: if on TanStack Query v4, rename gcTime to cacheTime.
//   Check with: cat package.json | grep tanstack
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

export default function RootLayout() {
  // Destructure both values -- ignoring fontError means the app can hang
  // forever on a blank screen if fonts fail to load on device
  const [fontsLoaded, fontError] = useFonts({
    'Cinzel-Regular': require('../assets/fonts/Cinzel-Regular.ttf'),
    'Cinzel-Bold': require('../assets/fonts/Cinzel-Bold.ttf'),
  });

  useEffect(() => {
    initGuestHearts().catch(() => {});
  }, []);

  useEffect(() => {
    if (__DEV__ && fontError) {
      // Surface font failures during development -- the app continues with
      // system fonts but this warning tells Henry something went wrong
      console.warn('[RootLayout] Font loading failed:', fontError.message);
    }
  }, [fontError]);

  useEffect(() => {
    // Hide splash once fonts are ready OR once font loading has failed.
    // Proceeding with system fonts is better than a permanently frozen screen.
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch((err) => {
        // Log in development so splash errors aren't invisible during testing
        if (__DEV__) {
          console.warn('[RootLayout] SplashScreen.hideAsync failed:', err);
        }
      });
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    // Wrap in SafeAreaProvider so this View respects the Android status bar.
    // GestureHandlerRootView is intentionally excluded here -- no gestures
    // can occur during the loading phase so it's unnecessary overhead.
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer} />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationGuard />
          <QueryClientProvider client={queryClient}>
            {/* headerShown: false covers all screens. expo-router auto-registers
                screens so no explicit Stack.Screen entries are needed here. */}
            <Stack screenOptions={{ headerShown: false }} />
            <AchievementToast />
          </QueryClientProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
});