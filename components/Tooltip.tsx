import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Radius, Spacing } from '../constants/theme';

export type TooltipPlacement = 'top' | 'bottom';

export type TooltipProps = {
  label: string;
  children: React.ReactElement;
  placement?: TooltipPlacement;
  delayMs?: number;
  dismissAfterMs?: number;
};

type TriggerLayout = {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
};

type TooltipSize = {
  width: number;
  height: number;
};

type TooltipPosition = {
  top: number;
  left: number;
};

const GAP = 8;
const EDGE_MARGIN = 8;
const SHOW_DURATION_MS = 150;
// Exit is intentionally faster — the system is responding, not deciding.
const HIDE_DURATION_MS = 100;

// Strong ease-out for entry: immediate velocity, decelerates in.
// Following the AnimatedSlot.tsx module-scope pattern in this codebase.
const EASING_IN = Easing.bezier(0.23, 1, 0.32, 1);
// Softer ease-out for exit: tooltip fades away evenly rather than decelerating
// into opacity=0, which makes the tail of the animation feel like it stalls.
const EASING_OUT = Easing.bezier(0.25, 0.46, 0.45, 0.94);

function computePosition(
  trigger: TriggerLayout,
  tooltip: TooltipSize,
  requestedPlacement: TooltipPlacement,
): TooltipPosition {
  // pageX/pageY are window-relative from measure() and account for scroll offsets.
  // Known limitation: Reanimated-animated ancestor transforms are not reflected
  // here because the shadow tree can lag the native layout tree by a frame.
  const { width: windowWidth, height: windowHeight } = Dimensions.get('window');

  let top = trigger.pageY - tooltip.height - GAP;
  let resolvedPlacement = requestedPlacement;

  if (requestedPlacement === 'bottom' || top < EDGE_MARGIN) {
    top = trigger.pageY + trigger.height + GAP;
    resolvedPlacement = 'bottom';
  }

  // If the bottom placement also overflows (e.g. element near the very bottom),
  // snap back to above-the-trigger and accept partial overlap as the least-bad outcome.
  if (resolvedPlacement === 'bottom' && top + tooltip.height > windowHeight - EDGE_MARGIN) {
    top = Math.max(EDGE_MARGIN, trigger.pageY - tooltip.height - GAP);
  }

  let left = trigger.pageX + trigger.width / 2 - tooltip.width / 2;
  left = Math.max(EDGE_MARGIN, Math.min(left, windowWidth - tooltip.width - EDGE_MARGIN));

  return { top, left };
}

export function Tooltip({
  label,
  children,
  placement = 'top',
  delayMs = 500,
  dismissAfterMs = 2500,
}: TooltipProps) {
  if (__DEV__ && !label) {
    console.warn('[Tooltip] label prop is empty — tooltip will render with no text');
  }

  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const triggerRef = useRef<View>(null);
  const pendingTriggerLayout = useRef<TriggerLayout | null>(null);
  const cachedTooltipSize = useRef<TooltipSize | null>(null);
  const isWaitingForLayout = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduceMotionRef = useRef(false);
  // Mirrors `visible` state synchronously — readable inside async callbacks without
  // waiting for React's batching cycle to flush.
  const visibleRef = useRef(false);
  // Guards async measure() callbacks that resolve after component unmounts.
  // Without this, animateIn can start a new dismiss timer that fires on a dead
  // component, and setVisibleSync permanently corrupts visibleRef.current = true.
  const mountedRef = useRef(true);

  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.95);
  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  useEffect(() => {
    mountedRef.current = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { reduceMotionRef.current = enabled; })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
      clearTimeout(dismissTimerRef.current);
      // Cancel in-flight Reanimated workloads on the UI thread so they don't
      // outlive the component. Matches the pattern in AnimatedSlot.tsx.
      cancelAnimation(opacity);
      cancelAnimation(scale);
    };
  }, [opacity, scale]);

  const setVisibleSync = useCallback((v: boolean) => {
    visibleRef.current = v;
    setVisible(v);
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimeout(dismissTimerRef.current);
    const duration = reduceMotionRef.current ? 0 : HIDE_DURATION_MS;
    opacity.value = withTiming(0, { duration, easing: EASING_OUT }, (finished) => {
      // `finished=false` means the animation was cancelled (e.g. by a rapid re-show
      // that set opacity.value directly). Do not collapse a freshly opening tooltip.
      if (finished) runOnJS(setVisibleSync)(false);
    });
    scale.value = withTiming(0.95, { duration, easing: EASING_OUT });
  }, [opacity, scale, setVisibleSync]);

  const animateIn = useCallback((trigLayout: TriggerLayout, tipSize: TooltipSize) => {
    // Prevent duplicate timers from concurrent measure() callbacks (two rapid
    // long-presses can dispatch two measure() calls whose callbacks both resolve).
    clearTimeout(dismissTimerRef.current);
    const pos = computePosition(trigLayout, tipSize, placement);
    setPosition(pos);
    const duration = reduceMotionRef.current ? 0 : SHOW_DURATION_MS;
    opacity.value = withTiming(1, { duration, easing: EASING_IN });
    scale.value = withTiming(1, { duration, easing: EASING_IN });
    if (dismissAfterMs > 0) {
      dismissTimerRef.current = setTimeout(hideTooltip, Math.max(0, dismissAfterMs));
    }
  }, [opacity, scale, placement, dismissAfterMs, hideTooltip]);

  const showTooltip = useCallback(() => {
    // Already visible: extend lifetime instead of re-animating. Re-animating
    // would set opacity=0 inside the measure() callback, flashing the tooltip
    // invisible for the async gap before measure() resolves.
    if (visibleRef.current) {
      clearTimeout(dismissTimerRef.current);
      if (dismissAfterMs > 0) {
        dismissTimerRef.current = setTimeout(hideTooltip, Math.max(0, dismissAfterMs));
      }
      return;
    }

    clearTimeout(dismissTimerRef.current);
    triggerRef.current?.measure((_, __, width, height, pageX, pageY) => {
      // Guard: component unmounted while measure() was in-flight (mid long-press
      // navigation). Without this, animateIn sets an orphaned dismiss timer and
      // setVisibleSync permanently writes visibleRef.current=true on a dead instance.
      if (!mountedRef.current) return;

      // Guard: measure() returns all-zeros for views not yet laid out (first render,
      // hidden ancestors, off-screen FlatList cells). Without this guard, computePosition
      // receives a zero-sized trigger and places the tooltip at the top-left corner.
      if (width === 0 && height === 0) return;

      const trigLayout: TriggerLayout = { pageX, pageY, width, height };
      pendingTriggerLayout.current = trigLayout;

      // Reset animation values here, inside the measure callback, NOT before it.
      // Setting them synchronously before measure() would flash the currently-visible
      // tooltip to opacity=0 for the native-bridge round-trip gap (~1 frame).
      opacity.value = 0;
      scale.value = 0.95;

      if (cachedTooltipSize.current) {
        // Bubble dimensions cached from a previous show — compute position and
        // begin animating immediately, skipping the off-screen measurement phase.
        animateIn(trigLayout, cachedTooltipSize.current);
      } else {
        // First show: render bubble off-screen at opacity=0, wait for onLayout
        // to fire with the bubble's actual dimensions, then call animateIn.
        isWaitingForLayout.current = true;
      }
      setVisibleSync(true);
    });
  }, [opacity, scale, animateIn, dismissAfterMs, hideTooltip, setVisibleSync]);

  const handleBubbleLayout = useCallback((e: LayoutChangeEvent) => {
    const size: TooltipSize = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    };
    // Persist so subsequent shows skip the off-screen measurement phase entirely.
    cachedTooltipSize.current = size;

    if (isWaitingForLayout.current && pendingTriggerLayout.current) {
      isWaitingForLayout.current = false;
      animateIn(pendingTriggerLayout.current, size);
    }
  }, [animateIn]);

  return (
    <View
      ref={triggerRef}
      // collapsable={false} is required on Android: without it the native view
      // may be optimised away into its parent, making ref.measure() return zeros.
      collapsable={false}
    >
      <Pressable
        onLongPress={showTooltip}
        delayLongPress={Math.max(0, delayMs)}
        accessibilityHint={label}
        // Suppress the wrapper's ripple on Android. The child element should
        // provide its own press feedback; a second ripple ring on an invisible
        // container looks like an artefact.
        android_ripple={{ color: 'transparent' }}
      >
        {children}
      </Pressable>

      <Modal
        transparent
        visible={visible}
        animationType="none"
        onRequestClose={hideTooltip}
        // statusBarTranslucent is intentionally absent.
        // With it, the Modal's Y=0 is the physical screen top; without it, Y=0
        // is the layout root (below the status bar) — matching what ref.measure()
        // returns for pageY. Misaligning the two coordinate systems shifts every
        // tooltip upward by StatusBar.currentHeight on Android.
      >
        {/* Full-screen backdrop: any tap outside the bubble dismisses the tooltip */}
        <Pressable style={StyleSheet.absoluteFill} onPress={hideTooltip}>
          <Animated.View
            style={[styles.bubble, animStyle, position ?? styles.offscreen]}
            onLayout={handleBubbleLayout}
            // pointerEvents='none' in StyleSheet (RN 0.72+ style API) — passes all
            // taps through the bubble to the backdrop Pressable for tap-to-dismiss.
            // importantForAccessibility and accessibilityElementsHidden hide the
            // bubble from the accessibility tree; the label is delivered via the
            // trigger Pressable's accessibilityHint instead.
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            <Text style={styles.label}>{label}</Text>
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    // pointerEvents as a style property (RN 0.72+ API, replaces the deprecated prop).
    // 'none' ensures neither the bubble nor its Text child consume touch events;
    // taps fall through to the backdrop Pressable and call hideTooltip.
    pointerEvents: 'none',
    backgroundColor: Colors.textPrimary,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    maxWidth: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 8,
    zIndex: 9999,
  },
  label: {
    color: Colors.surface,
    fontSize: 12,
    lineHeight: 16,
  },
  // Rendered off-screen while the bubble's dimensions are measured on first show.
  // opacity=0 during this phase ensures it is never visible.
  offscreen: {
    top: -9999,
    left: -9999,
  },
});
