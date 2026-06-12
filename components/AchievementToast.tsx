import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAchievementStore } from '../stores/achievementStore';
import { Colors, Fonts, Spacing, Radius } from '../constants/theme';

const SLIDE_MS    = 280;
const HOLD_MS     = 2800;
// 200px exceeds any realistic toast height including accessibility large-text.
// The component is positioned with `top: insets.top + Spacing.sm`, so starting
// at translateY = -200 places it well above the screen edge on all devices.
const HIDE_OFFSET = -200;

export function AchievementToast() {
  const toast        = useAchievementStore(s => s.toastQueue[0]);
  const dismissToast = useAchievementStore(s => s.dismissToast);
  const insets       = useSafeAreaInsets();
  const translateY   = useSharedValue(HIDE_OFFSET);
  // Tracks the key of the toast currently driving the animation. When a new
  // toast replaces the current one mid-animation, the old out-animation's
  // runOnJS callback fires after animatingKey has already advanced, making the
  // old dismiss() call a no-op rather than skipping the new toast.
  const animatingKey = useRef<number | null>(null);

  // translateY and dismissToast are intentionally absent from the dep array:
  // translateY is a Reanimated shared value (stable object reference for the
  // component lifetime) and dismissToast is a Zustand action (stable function
  // reference for the store lifetime). Neither can signal that a new animation
  // needs to start — only a new toast.key does that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) {
      // Reset animatingKey when the queue empties (e.g. after clearAll). Without
      // this, a slide-out completing after clearAll finds animatingKey still
      // matching the old key, calls dismissToast() on an empty queue, and emits
      // a new [] reference into Zustand — triggering a spurious re-render.
      animatingKey.current = null;
      translateY.value = HIDE_OFFSET;
      return;
    }

    animatingKey.current = toast.key;
    const key = toast.key;
    const dismiss = () => {
      if (animatingKey.current === key) dismissToast();
    };

    translateY.value = withSequence(
      withTiming(0, { duration: SLIDE_MS }),
      withDelay(HOLD_MS, withTiming(HIDE_OFFSET, { duration: SLIDE_MS }, () => runOnJS(dismiss)())),
    );
  }, [toast?.key]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!toast) return null;

  return (
    <Animated.View
      style={[styles.container, { top: insets.top + Spacing.sm }, aStyle]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Achievement unlocked: ${toast.def.name}. ${toast.def.description}`}
    >
      <Text style={styles.icon} accessible={false}>{toast.def.icon}</Text>
      <View style={styles.textBlock}>
        <Text style={styles.header}>Achievement Unlocked!</Text>
        <Text style={styles.name} numberOfLines={1}>{toast.def.name}</Text>
        <Text style={styles.desc} numberOfLines={1}>{toast.def.description}</Text>
      </View>
      {toast.def.rewardCoins > 0 && (
        <Text style={styles.coins} accessible={false}>+{toast.def.rewardCoins} 🪙</Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    zIndex: 9999,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  icon: {
    fontSize: 32,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  header: {
    fontFamily: Fonts.display,
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 1.5,
  },
  name: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  desc: {
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 14,
  },
  coins: {
    fontFamily: Fonts.displayBold,
    fontSize: 14,
    color: Colors.gold,
  },
});
