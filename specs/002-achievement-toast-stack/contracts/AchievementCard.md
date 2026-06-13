# Contract: `AchievementCard` Internal Component

**File**: `components/AchievementToast.tsx` (internal, not exported)
**Parent**: `AchievementToast` (the exported root component)
**Instances**: Up to `MAX_VISIBLE` (5) mounted simultaneously

---

## Props

```ts
type AchievementCardProps = {
  toast:     ToastItem;   // the queue item this card represents
  index:     number;      // position in the visible slice [0..4]; 0 = topmost
  onDismiss: () => void;  // calls dismissToastByKey(toast.key) in parent
};
```

| Prop | Description |
|------|-------------|
| `toast` | Stable reference for the card's lifetime. `toast.key` never changes. |
| `index` | Changes when a card above this one is dismissed. Triggers reposition animation. |
| `onDismiss` | Stable callback (memoised in parent). Called by both auto-dismiss timer and tap handler. |

---

## Internal animation values

| Value | Type | Purpose |
|-------|------|---------|
| `translateX` | `SharedValue<number>` | Entry/exit slide. Starts at `OFFSCREEN_X`, animates to `0` on mount, back to `OFFSCREEN_X` on dismiss. |
| `topAnim` | `SharedValue<number>` | Vertical position. Set immediately on mount; animated with `withTiming` when `index` prop changes. |
| `mountedRef` | `MutableRefObject<boolean>` | Guards `setTimeout` callback after unmount. Set `false` in cleanup. |
| `dismissingRef` | `MutableRefObject<boolean>` | Prevents double-dismiss (tap + simultaneous timer expiry). |

---

## Positioning formula

```
CARD_WIDTH  = 280
CARD_HEIGHT = 76
CARD_GAP    = 8    (Spacing.sm)
CARD_RIGHT  = 16   (Spacing.md)
OFFSCREEN_X = CARD_WIDTH + CARD_RIGHT + 8

topAt(index, insets) = insets.top + Spacing.sm + index * (CARD_HEIGHT + CARD_GAP)
```

The card's `StyleSheet` uses `position: 'absolute'`, `right: CARD_RIGHT`, `width: CARD_WIDTH`. Vertical position is driven entirely by `topAnim` via `useAnimatedStyle`.

---

## Lifecycle

```
mount
  └─ topAnim.value = topAt(index, insets)       (no animation — set immediately)
  └─ translateX: OFFSCREEN_X → 0, 280ms ease-out
  └─ setTimeout(exitSequence, 4000)

index prop changes (card above dismissed)
  └─ topAnim: current → topAt(newIndex, insets), 250ms ease-out

tap
  └─ if dismissingRef.current: return            (already exiting)
  └─ dismissingRef.current = true
  └─ clearTimeout(autoTimer)
  └─ translateX: 0 → OFFSCREEN_X, 220ms ease-in
  └─ runOnJS(onDismiss)() after animation

autoTimer fires (4000ms)
  └─ if !mountedRef.current: return
  └─ if dismissingRef.current: return
  └─ dismissingRef.current = true
  └─ translateX: 0 → OFFSCREEN_X, 220ms ease-in
  └─ runOnJS(onDismiss)() after animation

unmount
  └─ mountedRef.current = false
  └─ clearTimeout(autoTimer)
  └─ cancelAnimation(translateX)
  └─ cancelAnimation(topAnim)
```

---

## Accessibility

| Attribute | Value |
|-----------|-------|
| `accessibilityLiveRegion` | `"polite"` — announces card content to screen reader when it appears |
| `accessibilityLabel` | `"Achievement unlocked: {name}. {description}"` |
| `accessibilityRole` | `"alert"` — communicates the notification nature |
| Inner `Text` nodes | `accessible={false}` — content is covered by the parent label |

---

## Reduced-motion behaviour

When `AccessibilityInfo.isReduceMotionEnabled()` returns `true`:
- Entry: `translateX` set instantly (duration `0`)
- Exit: `translateX` set instantly (duration `0`)
- Reposition: `topAnim` set instantly (duration `0`)
- Auto-dismiss timer: **unchanged** (4 seconds)

---

## Exports

`AchievementCard` is **not exported** from `AchievementToast.tsx`. It is an implementation detail of the overlay system. Callers interact exclusively via `useAchievements()`.

The only export from `AchievementToast.tsx` is:
```ts
export function AchievementToast(): React.ReactElement | null
```
