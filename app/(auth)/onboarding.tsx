import { useCallback, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Animated,
  StatusBar,
  ListRenderItemInfo,
  Alert,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useAuth } from '../../context/AuthContext'
import { Colors, Fonts } from '../../constants/theme'

type Slide = {
  emoji: string
  title: string
  subtitle: string
}

const SLIDES: Slide[] = [
  {
    emoji: '🏛️',
    title: 'Test Your Knowledge',
    subtitle: '2,340 questions across 26 civilisations',
  },
  {
    emoji: '⚡',
    title: 'Earn XP & Level Up',
    subtitle: 'Track your progress and climb the levels',
  },
  {
    emoji: '❤️',
    title: 'Never Run Out',
    subtitle: 'Buy extra hearts to keep your streak alive',
  },
  {
    emoji: '⚔️',
    title: 'Choose Your Era',
    subtitle: 'From Ancient Egypt to the Cold War',
  },
]

export default function OnboardingScreen() {
  const router = useRouter()
  const { signInAnonymously } = useAuth()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()

  const [currentIndex, setCurrentIndex] = useState(0)
  const [guestLoading, setGuestLoading] = useState(false)
  // Seed with an estimate so slides are correctly sized on the first paint.
  // onLayout refines the value one frame later; the correction is imperceptible.
  const [listHeight, setListHeight] = useState(() => Math.max(screenHeight - 240, 300))

  const flatListRef = useRef<FlatList<Slide>>(null)
  const scrollX = useRef(new Animated.Value(0)).current

  // useRef, not useMemo: React may discard useMemo values as a performance
  // optimisation. useRef guarantees the handler is created exactly once.
  const scrollHandler = useRef(
    Animated.event(
      [{ nativeEvent: { contentOffset: { x: scrollX } } }],
      { useNativeDriver: false },
    ),
  ).current

  // Recomputed only when screenWidth changes. scrollX is included in deps so
  // the lint rule is satisfied without suppression — it is a stable Animated.Value
  // reference that never changes, so including it causes no extra re-computations.
  const dotOpacities = useMemo(
    () =>
      SLIDES.map((_, i) =>
        scrollX.interpolate({
          inputRange: [
            (i - 1) * screenWidth,
            i * screenWidth,
            (i + 1) * screenWidth,
          ],
          outputRange: [0.3, 1, 0.3],
          extrapolate: 'clamp',
        }),
      ),
    [scrollX, screenWidth],
  )

  // Guards against rapid double-taps scrolling past the target slide.
  // MUST be set AFTER confirming flatListRef.current is non-null; otherwise
  // onMomentumScrollEnd never fires and the Next button is permanently locked.
  const isScrollingRef = useRef(false)

  // Ref-based guard so handleGuest can be truly stable (no state in deps).
  // guestLoading state is kept for UI feedback; guestLoadingRef is the real guard.
  const guestLoadingRef = useRef(false)

  const isLastSlide = currentIndex === SLIDES.length - 1

  const handleNext = useCallback(() => {
    if (isScrollingRef.current) return
    const nextIndex = currentIndex + 1
    if (nextIndex >= SLIDES.length) return
    // Null-check before locking — if the ref is null the scroll is a no-op
    // and onMomentumScrollEnd never fires, permanently locking the button.
    if (!flatListRef.current) return

    isScrollingRef.current = true
    flatListRef.current.scrollToOffset({ offset: nextIndex * screenWidth, animated: true })
    // Immediate update so the button label switches before momentum ends
    setCurrentIndex(nextIndex)
  }, [currentIndex, screenWidth])

  // Stable: signInAnonymously and router are both stable references.
  // The loading guard uses a ref so guestLoading state is NOT a dependency,
  // preventing the function from being recreated on every loading transition.
  const handleGuest = useCallback(async () => {
    if (guestLoadingRef.current) return
    guestLoadingRef.current = true
    setGuestLoading(true)
    try {
      await signInAnonymously()
      router.replace('/(auth)/username')
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Could not sign in. Please try again.'
      Alert.alert('Sign-In Failed', message)
    } finally {
      guestLoadingRef.current = false
      setGuestLoading(false)
    }
  }, [signInAnonymously, router])

  // Memoised so FlatList doesn't re-render all slides on unrelated state
  // changes (guestLoading, currentIndex). Re-created only when layout changes.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => (
      <View style={{ width: screenWidth, height: listHeight }}>
        <View style={styles.illustrationArea}>
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>
        <View style={styles.textArea}>
          <Text style={styles.slideTitle}>{item.title}</Text>
          <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
        </View>
      </View>
    ),
    [screenWidth, listHeight],
  )

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth)
      setCurrentIndex(index)
      isScrollingRef.current = false
    },
    [screenWidth],
  )

  const getItemLayout = useCallback(
    (_: ArrayLike<Slide> | null | undefined, index: number) => ({
      length: screenWidth,
      offset: screenWidth * index,
      index,
    }),
    [screenWidth],
  )

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View
        style={styles.listContainer}
        onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
      >
        <FlatList
          ref={flatListRef}
          data={SLIDES}
          renderItem={renderItem}
          keyExtractor={(item) => item.title}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={scrollHandler}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          getItemLayout={getItemLayout}
          style={styles.flatList}
        />
      </View>

      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {dotOpacities.map((opacity, i) => (
            <Animated.View key={i} style={[styles.dot, { opacity }]} />
          ))}
        </View>

        {isLastSlide ? (
          <View style={styles.lastSlideButtons}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push('/(auth)/welcome')}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Sign In / Sign Up</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.guestButton}
              onPress={handleGuest}
              activeOpacity={0.8}
              disabled={guestLoading}
            >
              <Text style={styles.guestButtonText}>
                {guestLoading ? 'Loading…' : 'Continue as Guest'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleNext}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  listContainer: { flex: 1 },
  flatList: { flex: 1 },
  illustrationArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  emoji: { fontSize: 100 },
  textArea: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    gap: 12,
  },
  slideTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.gold,
    textAlign: 'center',
    letterSpacing: 1,
  },
  slideSubtitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.gold,
  },
  lastSlideButtons: { gap: 12 },
  primaryButton: {
    backgroundColor: Colors.gold,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: Fonts.displayBold,
    fontSize: 15,
    color: Colors.bg,
    letterSpacing: 0.5,
  },
  guestButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  guestButtonText: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textMuted,
  },
})
