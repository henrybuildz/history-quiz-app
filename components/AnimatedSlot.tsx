import { useEffect, memo } from 'react';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

// Shared timing constants — single source of truth for entrance animations.
// Import these in screens instead of redeclaring per-file.
export const ENTRANCE_STAGGER_MS = 55;
export const ENTRANCE_MAX_DELAY_MS = 600;
export const ENTRANCE_DURATION_MS = 380;

// Allocated once at module scope — Easing.out returns a new worklet-wrapped
// function; sharing one instance avoids repeated allocation per AnimatedSlot mount.
const ENTRANCE_EASING = Easing.out(Easing.cubic);

export type AnimatedSlotProps = {
  delay: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

// Wrapped with memo so parent re-renders (e.g. from future state additions)
// don't needlessly re-render every animated card in the hierarchy.
export const AnimatedSlot = memo(function AnimatedSlot({
  delay,
  duration = ENTRANCE_DURATION_MS,
  style,
  children,
}: AnimatedSlotProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  useEffect(() => {
    // Reset before (re-)triggering so the animation starts fresh if delay changes.
    opacity.value = 0;
    translateY.value = 24;

    opacity.value = withDelay(
      delay,
      withTiming(1, { duration, easing: ENTRANCE_EASING }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration, easing: ENTRANCE_EASING }),
    );

    // Cancel worklet animations on unmount to prevent orphaned UI-thread work.
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translateY);
    };
  // delay, duration, opacity, translateY are stable refs; listed for exhaustive-deps compliance.
  }, [delay, duration, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // Caller layout styles first; animation-owned opacity/transform always win.
  return (
    <Animated.View style={[style, animStyle]}>
      {children}
    </Animated.View>
  );
});
