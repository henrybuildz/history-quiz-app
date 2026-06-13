# Implementation Plan: Achievement Notification Stack

**Branch**: `002-achievement-toast-stack` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-achievement-toast-stack/spec.md`

## Summary

Upgrade the existing single-card `AchievementToast` component into a multi-card stacking overlay. The store already exists (`stores/achievementStore.ts`), is already mounted at the root (`app/_layout.tsx`), and already receives achievement IDs from the quiz screen. This feature is entirely an upgrade of two existing files plus one new file — no new providers, no new routing, no migrations.

**What changes:**

| File | Change |
|------|--------|
| `stores/achievementStore.ts` | Add `dismissToastByKey(key: number)`; rename / remove `dismissToast` |
| `components/AchievementToast.tsx` | Rewrite: multi-card renderer + per-card `AchievementCard` sub-component |
| `hooks/useAchievements.ts` | **New**: typed hook wrapper for consumers |
| `app/_layout.tsx` | No changes |
| `app/quiz/[era].tsx` | No changes |

## Technical Context

**Language/Version**: TypeScript 5.x, React Native 0.85.3

**Primary Dependencies**:
- `react-native-reanimated` v3 — `useSharedValue`, `useAnimatedStyle`, `withTiming`, `withDelay`, `runOnJS`, `cancelAnimation`
- `zustand` v5 — global notification queue, no Context needed
- `react-native-safe-area-context` — `useSafeAreaInsets` for top-edge offset
- `react-native` — `AccessibilityInfo.isReduceMotionEnabled()`

**Storage**: None — notification state is ephemeral, lives in Zustand only

**Testing**: Manual via Expo Simulator (no automated tests requested)

**Target Platform**: iOS 15+ and Android (Expo SDK 56)

**Performance Goals**:
- Entry animation: 280ms, ease-out cubic (matches `AnimatedSlot.tsx` easing pattern)
- Exit animation: 220ms, ease-in
- Reposition animation: 250ms, ease-out cubic
- ≤5 `Animated.View` instances in the overlay at any time

**Constraints**:
- Layout isolation: cards use `position: 'absolute'` outside document flow — no siblings may shift
- Max 5 cards visible simultaneously; remaining queue items wait
- `translateX` entry/exit (right edge) — NOT `translateY` (the current top-slide is replaced)
- Each card has its own independent 4-second auto-dismiss timer

**Scale/Scope**: Single overlay component tree; in-session ephemeral state only

## Constitution Check

Constitution file is a placeholder template with no enacted rules — no gates apply. Proceeding.

## Project Structure

### Documentation (this feature)

```text
specs/002-achievement-toast-stack/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── useAchievements.md      ← hook contract
│   └── AchievementCard.md      ← component props contract
└── tasks.md             ← Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
stores/
└── achievementStore.ts    ← modified: add dismissToastByKey, remove dismissToast

hooks/
└── useAchievements.ts     ← new: typed consumer hook

components/
└── AchievementToast.tsx   ← rewritten: multi-card stack renderer
                              + internal AchievementCard sub-component

app/
├── _layout.tsx            ← unchanged (AchievementToast already mounted)
└── quiz/[era].tsx         ← unchanged (already calls enqueueToasts)
```

**Structure Decision**: Single-project mobile app (Expo). No backend changes. No new directories except `hooks/` (consistent with the project's existing `stores/`, `context/`, `lib/` separation).

## Architecture

### State Layer — `stores/achievementStore.ts`

**What changes**: `dismissToast()` removes only the queue head (index 0). With multiple simultaneous visible cards each managing their own timers, any card can be dismissed first. Replace with `dismissToastByKey(key: number)` which removes by key from any position.

**No structural change to `toastQueue`**: The store keeps `toastQueue: ToastItem[]` as a FIFO queue. The component renders `toastQueue.slice(0, MAX_VISIBLE)` as the visible set. When a visible card dismisses via `dismissToastByKey`, the next item in the queue (if any) becomes the new 5th visible card.

**Backward compat note**: `dismissToast()` is only called internally by `AchievementToast.tsx`. Since we're rewriting that component entirely, the old function is removed (not aliased). No external callers.

### Hook Layer — `hooks/useAchievements.ts`

Thin typed wrapper over the store. Exposes only the API that consumers should use:

```
enqueueToasts(ids: string[]): void   // trigger notifications from any component
unlockedIds: Set<string>             // for conditional "already unlocked" UI guards
```

Does not expose `dismissToastByKey` or `toastQueue` — those are internal to `AchievementToast.tsx`.

**Why a hook and not a Context Provider**: Zustand stores are global singletons accessible without React context. A Context Provider wrapping the whole app would cause the entire subtree to re-render on every toast queue change. The Zustand selector pattern (`useAchievementStore(s => s.enqueueToasts)`) already gives per-selector subscriptions. The hook is a thin stable-API layer, not a new mechanism.

### Component Layer — `components/AchievementToast.tsx`

**Top-level `AchievementToast`**: Reads `toastQueue.slice(0, MAX_VISIBLE)` from the store. Renders one `AchievementCard` per visible item. No animation logic here — purely orchestration.

**`AchievementCard` (internal, not exported)**: Each card owns:
- `translateX` shared value — drives entry (right→0) and exit (0→right) animation
- `topAnim` shared value — drives vertical reposition when index changes
- A `useEffect` on mount: start entry animation, schedule 4-second `setTimeout` for auto-dismiss
- A `useEffect` on `index` prop change: animate `topAnim` to new `top` value when cards above dismiss
- A `mountedRef` guard (same pattern as `Tooltip.tsx`) for async timer callbacks after unmount
- `onPress` → immediate exit animation → `dismissToastByKey`
- `AccessibilityInfo.isReduceMotionEnabled()` — skip `translateX` animation if true

**Positioning math**:
```
CARD_WIDTH    = 280     (px, fixed — avoids per-card onLayout measurement)
CARD_HEIGHT   = 76      (px, estimated — matches current component content height)
CARD_GAP      = 8       (px — Spacing.sm)
CARD_RIGHT    = 16      (px — Spacing.md)
OFFSCREEN_X   = CARD_WIDTH + CARD_RIGHT + 8  (ensures card fully clears right edge)

card top at index i = insets.top + Spacing.sm + i * (CARD_HEIGHT + CARD_GAP)
```

**Why fixed `CARD_WIDTH` instead of `onLayout`**: `onLayout` fires after layout, meaning on first show the card would appear at wrong position for one frame. A fixed width constant gives correct position immediately. The value (280px) is chosen to fit the longest achievement name in the catalog ("Living Encyclopedia") at 14px Cinzel-Bold.

**Layout isolation**: Each `AchievementCard` uses `position: 'absolute'` with `right: CARD_RIGHT`. The cards are rendered as siblings of `<Stack>` inside `RootLayout` — they are never inside a flex container that responds to their presence. The overlay is already in the correct place in `_layout.tsx`.

### Animation Detail

**Entry** (card mounts):
```
translateX: OFFSCREEN_X → 0
duration: 280ms
easing: Easing.out(Easing.cubic)   ← matches AnimatedSlot.tsx ENTRANCE_EASING
```

**Exit** (auto-dismiss or tap):
```
translateX: 0 → OFFSCREEN_X
duration: 220ms
easing: Easing.in(Easing.cubic)    ← reversed for exit
callback: runOnJS(dismissToastByKey)(key)
```

**Reposition** (card above dismissed, index decreases by 1):
```
topAnim: currentTop → newTop
duration: 250ms
easing: Easing.out(Easing.cubic)
```

**Reduced motion** (AccessibilityInfo.isReduceMotionEnabled):
```
Entry/exit: duration: 0 (instant appear/disappear, translateX still set but instant)
Reposition: duration: 0
Timer: unchanged (4 seconds)
```

**Race condition guard**: Each `AchievementCard` sets `animatingRef.current = false` in cleanup. The `setTimeout` callback checks this ref before starting exit animation — prevents a stale timer firing after the card was manually dismissed and unmounted.

## Complexity Tracking

No constitution violations. No unusual complexity introduced. The upgrade replaces ~137 lines with ~220 lines across the same file. All new code follows patterns already established in `Tooltip.tsx` and `AnimatedSlot.tsx`.
