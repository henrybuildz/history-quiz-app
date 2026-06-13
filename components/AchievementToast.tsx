import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { useAchievementStore, type ToastItem } from '../stores/achievementStore';
import { Colors, Fonts, Spacing, Radius } from '../constants/theme';

// ── Layout constants ───────────────────────────────────────────────────────────

const MAX_VISIBLE      = 5;
const CARD_WIDTH       = 280;
// Estimated height: paddingVertical(8×2) + name(~21px) + desc(14px) + gap(2px) ≈ 61px,
// rounded up to 76 to match the tallest emoji icon baseline. Adjust if cards overlap.
const CARD_HEIGHT      = 76;
const CARD_GAP         = Spacing.sm;   // 8
const CARD_RIGHT       = Spacing.md;   // 16
// Enough to fully clear the right screen edge on any device width.
const OFFSCREEN_X      = CARD_WIDTH + CARD_RIGHT + 8;

// ── Timing constants ───────────────────────────────────────────────────────────

const DISMISS_DELAY_MS = 4000;
const SLIDE_IN_MS      = 280;
const SLIDE_OUT_MS     = 220;
const REPOSITION_MS    = 250;

// Allocated once at module scope — same pattern as AnimatedSlot.tsx.
const EASING_OUT = Easing.out(Easing.cubic);
const EASING_IN  = Easing.in(Easing.cubic);

// ── AchievementCard ────────────────────────────────────────────────────────────

type AchievementCardProps = {
  toast:     ToastItem;
  index:     number;
  insets:    EdgeInsets;
  onDismiss: () => void;
};

function AchievementCard({ toast, index, insets, onDismiss }: AchievementCardProps) {
  const translateX      = useSharedValue(OFFSCREEN_X);
  const topAnim         = useSharedValue(insets.top + Spacing.sm + index * (CARD_HEIGHT + CARD_GAP));
  const mountedRef      = useRef(true);
  const dismissingRef   = useRef(false);
  const hasMountedRef   = useRef(false);
  const autoTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduceMotionRef = useRef(false);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    top: topAnim.value,
  }));

  // Mount: read reduce-motion preference, start entry slide, schedule auto-dismiss.
  // Entry animation starts after isReduceMotionEnabled resolves so the duration
  // is always correct. The card sits off-screen at OFFSCREEN_X until then.
  useEffect(() => {
    hasMountedRef.current = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => {
        if (!mountedRef.current) return;
        reduceMotionRef.current = v;
        translateX.value = withTiming(0, {
          duration: v ? 0 : SLIDE_IN_MS,
          easing: EASING_OUT,
        });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        translateX.value = withTiming(0, { duration: SLIDE_IN_MS, easing: EASING_OUT });
      });

    autoTimerRef.current = setTimeout(() => {
      if (!mountedRef.current || dismissingRef.current) return;
      dismissingRef.current = true;
      translateX.value = withTiming(OFFSCREEN_X, {
        duration: reduceMotionRef.current ? 0 : SLIDE_OUT_MS,
        easing: EASING_IN,
      }, () => runOnJS(onDismiss)());
    }, DISMISS_DELAY_MS);

    return () => {
      mountedRef.current = false;
      clearTimeout(autoTimerRef.current);
      cancelAnimation(translateX);
      cancelAnimation(topAnim);
    };
  // onDismiss, translateX, topAnim are stable for this card's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reposition: animate vertically when a card above this one is dismissed.
  // hasMountedRef guard prevents an animated reposition on the initial render —
  // topAnim is already set to the correct position by useSharedValue(initialTop).
  useEffect(() => {
    if (!hasMountedRef.current) return;
    const newTop = insets.top + Spacing.sm + index * (CARD_HEIGHT + CARD_GAP);
    topAnim.value = withTiming(newTop, {
      duration: reduceMotionRef.current ? 0 : REPOSITION_MS,
      easing: EASING_OUT,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function handlePress() {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    clearTimeout(autoTimerRef.current);
    translateX.value = withTiming(OFFSCREEN_X, {
      duration: reduceMotionRef.current ? 0 : SLIDE_OUT_MS,
      easing: EASING_IN,
    }, () => runOnJS(onDismiss)());
  }

  return (
    <Animated.View
      style={[styles.card, animStyle]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessibilityLabel={`Achievement unlocked: ${toast.def.name}. ${toast.def.description}`}
    >
      <Pressable
        onPress={handlePress}
        android_ripple={{ color: 'transparent' }}
        style={styles.pressableContent}
      >
        <Text style={styles.icon} accessible={false}>{toast.def.icon}</Text>
        <View style={styles.textBlock}>
          <Text style={styles.name} numberOfLines={1}>{toast.def.name}</Text>
          <Text style={styles.desc} numberOfLines={1}>{toast.def.description}</Text>
        </View>
        {toast.def.rewardCoins > 0 && (
          <Text style={styles.coins} accessible={false}>+{toast.def.rewardCoins} 🪙</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ── AchievementToast (root overlay) ───────────────────────────────────────────

export function AchievementToast() {
  const queue             = useAchievementStore(s => s.toastQueue);
  const dismissToastByKey = useAchievementStore(s => s.dismissToastByKey);
  const insets            = useSafeAreaInsets();

  if (queue.length === 0) return null;

  return (
    <>
      {queue.slice(0, MAX_VISIBLE).map((toast, index) => (
        <AchievementCard
          key={toast.key}
          toast={toast}
          index={index}
          insets={insets}
          onDismiss={() => dismissToastByKey(toast.key)}
        />
      ))}
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    right: CARD_RIGHT,
    width: CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    zIndex: 9999,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  pressableContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  icon: {
    fontSize: 32,
  },
  textBlock: {
    flex: 1,
    gap: 2,
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
