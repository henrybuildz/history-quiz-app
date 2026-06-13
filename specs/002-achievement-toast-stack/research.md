# Research: Achievement Notification Stack

**Feature**: 002-achievement-toast-stack | **Date**: 2026-06-12

---

## Decision 1: Zustand store vs React Context for notification state

**Decision**: Keep Zustand (`stores/achievementStore.ts`). Add a `hooks/useAchievements.ts` wrapper. No Context Provider.

**Rationale**: The store already exists, is already mounted, and already receives achievement IDs from the quiz screen. A Context Provider wrapping `RootLayout` would cause the entire app tree (including the quiz screen, tab bar, and all other screens) to re-render on every queue change. Zustand's per-selector subscriptions (`useAchievementStore(s => s.toastQueue)`) only re-render the components that subscribe. For an overlay that can change state several times per minute during active play, this is a meaningful difference.

The `useAchievements()` hook provides a stable, typed API boundary so no consumer needs to know about the store shape. This is the same pattern used by `useProfileSignal` in `stores/profileSignal.ts`.

**Alternatives considered**:
- `React.createContext` + `useReducer`: Clean API but causes tree-wide re-renders on every enqueue/dismiss. Rejected.
- `mitt` or other event emitter: Decoupled but bypasses React's render cycle entirely, making the queue invisible to React DevTools and harder to test. Rejected.
- Keeping the store as-is without a hook wrapper: Works but exposes `toastQueue` and `dismissToastByKey` to callers who shouldn't touch them. Rejected in favor of a thin hook.

---

## Decision 2: Upgrade existing files vs create new component

**Decision**: Upgrade `components/AchievementToast.tsx` in-place. Do not create a parallel component.

**Rationale**: `AchievementToast` is already imported and rendered in `app/_layout.tsx`. The quiz screen already calls `useAchievementStore.getState().enqueueToasts()`. Creating a new component would require updating `_layout.tsx`, potentially leaving the old component orphaned, and splitting the mental model. The existing component is 137 lines — a clean rewrite is straightforward.

**Alternatives considered**:
- New `AchievementToastStack.tsx` alongside the old component: Creates a dead-code zombie in the codebase until the old import in `_layout.tsx` is removed. Rejected.
- Wrapper component that renders the existing `AchievementToast` multiple times: Can't share `translateX` state or coordinate reposition timing across instances. Rejected.

---

## Decision 3: `translateX` (right-edge slide) vs `translateY` (top-edge slide)

**Decision**: Replace `translateY` with `translateX`. Cards slide in from the right screen edge and exit to the right.

**Rationale**: The spec explicitly requires top-right corner positioning with slide-in/out from the right edge. The current implementation slides from the top (negative `translateY`), which was designed for a full-width banner that enters from above. The new compact card (280px wide, anchored to the right) naturally animates from the right — consistent with iOS notification behavior and the "absolute isolation" requirement.

**Technical note**: The current `withSequence(slideIn, withDelay(HOLD, slideOut))` pattern drives a single shared value for the full lifecycle. The new design separates concerns: entry animation fires on mount, exit animation fires from a `setTimeout` callback (or tap handler). This is necessary because with stacking, each card has its own independent timer and can exit at any time, not just after a fixed sequence.

---

## Decision 4: Fixed `CARD_WIDTH` vs `onLayout` measurement

**Decision**: Fixed constant `CARD_WIDTH = 280`.

**Rationale**: `onLayout` fires after the native layout pass, meaning on the very first show, the card would be positioned at `right: 0` but with `width: undefined` — causing a one-frame flash at the wrong position. A fixed width avoids this. 280px is verified to fit "Living Encyclopedia" (the longest achievement name, 19 chars) at 14px Cinzel-Bold with a 32px emoji icon and coin reward suffix. Tested at 320px screen width (smallest supported iPhone SE).

**Alternatives considered**:
- `onLayout` + off-screen pre-render (opacity 0): Same two-phase approach as `Tooltip.tsx`. Would work but adds complexity for a simpler problem. Achievement cards don't have dynamic label lengths the way tooltips do. Rejected for simplicity.
- `useWindowDimensions` to derive width as a fraction of screen: Makes cards too wide on tablets. Rejected.

---

## Decision 5: Per-card `AchievementCard` sub-component vs single component managing array

**Decision**: Extract `AchievementCard` as an internal (non-exported) sub-component with its own animation hooks.

**Rationale**: Each card needs its own `translateX`, `topAnim`, `mountedRef`, and `setTimeout`. Storing these as parallel arrays inside a single component (`translateXValues[0]`, `translateXValues[1]`, ...) violates the Rules of Hooks (hooks cannot be called conditionally or in loops) and makes the cleanup logic fragile. A sub-component gives each card isolated hook calls that mount/unmount naturally with the card's lifetime.

This matches the standard React pattern for lists of animated items (e.g., how `FlatList` items are separate components).

**Alternatives considered**:
- Single component with a `useRef` array of shared values: Violates Rules of Hooks. Cannot call `useSharedValue` in a loop. Rejected.
- Reanimated `useAnimatedRef` + layout animations: Reanimated `Layout` transitions (like `LinearTransition`) only animate position changes caused by React re-renders. Since each card is `position: absolute` (not in flow), layout animations don't apply. Rejected.

---

## Decision 6: `dismissToastByKey` signature

**Decision**: `dismissToastByKey(key: number): void` — removes the item with the matching key from any position in `toastQueue`.

**Rationale**: With up to 5 simultaneous visible cards each having independent timers, the dismissed card may be at any index. The existing `dismissToast()` only removes `toastQueue[0]`. A key-based lookup is O(n) on a max-5-item slice — negligible. Using `key` (the monotonic integer already in `ToastItem`) avoids coupling to array index.

**Note on backward compat**: `dismissToast()` is only called internally by `AchievementToast.tsx`. No other file in the codebase calls it. Removing and replacing it is safe — confirmed by grepping all files.

---

## Decision 7: Where new `hooks/` directory lives

**Decision**: `hooks/useAchievements.ts` at project root level (`/hooks/`), parallel to `/stores/`, `/lib/`, `/context/`.

**Rationale**: The project already has `stores/`, `context/`, `lib/` as root-level directories. A `hooks/` directory is consistent with this flat structure and the Expo Router convention for co-locating non-route logic at the project root. The directory does not exist yet — this feature creates it.

**Note**: Expo Router scans the `app/` directory for routes. Files outside `app/` are never treated as routes regardless of name.
