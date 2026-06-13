# Research: Tooltip Component

**Feature**: 001-tooltip-component | **Date**: 2026-06-12

---

## Finding 1: Platform is React Native, not Web React

**Decision**: The component must be implemented as a React Native component using `StyleSheet.create()`, `react-native-reanimated`, and RN layout APIs. No CSS, no browser hover events.

**Rationale**: Every source file in the project imports from `react-native` or `react-native-reanimated`. There are zero `.css` files. The spec was drafted before project context was examined and assumed a web React environment.

**Alternatives considered**: CSS Modules, styled-components — both inapplicable; project has no CSS infrastructure and StyleSheet is the established convention.

---

## Finding 2: Component placement — flat `components/` directory

**Decision**: Place the component at `components/Tooltip.tsx`. No subdirectory. No separate style file.

**Rationale**: The project's only two components (`AchievementToast.tsx`, `AnimatedSlot.tsx`) both live directly in `components/` as single PascalCase `.tsx` files with styles declared via `StyleSheet.create()` at the bottom of the same file. No feature subdirectories, no atomic design layers, no barrel index files. Introducing a subdirectory or a separate style file would deviate from the established convention with no benefit at the project's current scale.

**Alternatives considered**:
- `components/ui/Tooltip.tsx` — valid for larger codebases; premature here given only 2 existing components
- `components/Tooltip/index.tsx` — adds directory wrapping without benefit; not used anywhere in the project

---

## Finding 3: "Hover" has no equivalent in React Native

**Decision**: The tooltip trigger must use **long-press** (`onLongPress`) as the show gesture, with a tap elsewhere or a timeout to dismiss. `onMouseEnter`/`onMouseLeave` do not exist in React Native.

**Rationale**: React Native's `Pressable` and `TouchableOpacity` expose `onPress`, `onPressIn`, `onPressOut`, and `onLongPress` — not pointer hover. The spec's hover requirement must be re-interpreted for mobile: long-press is the standard mobile convention for showing contextual labels (used by iOS and Android system UI alike).

**Alternatives considered**:
- `onPressIn` with no delay — shows tooltip on any tap start, which conflicts with normal button presses
- `onHoverIn`/`onHoverOut` via React Native Web — only works in web builds; project targets iOS/Android

---

## Finding 4: Click passthrough — use `Pressable` wrapping

**Decision**: Wrap the child in a `Pressable` that handles `onLongPress` (show tooltip) while forwarding `onPress` directly to the child's own handler via prop cloning.

**Rationale**: React Native's `Pressable` does not intercept events on nested pressables by default when properly structured. The Tooltip wrapper handles only `onLongPress`; the wrapped child's `onPress` fires normally on short taps. This directly satisfies FR-003 (no click interception).

---

## Finding 5: Positioning — `measure()` + absolute overlay

**Decision**: Use `ref.current.measure(...)` to get the trigger's screen coordinates, then render the tooltip in an absolute-positioned overlay at the computed position. Clamp to `Dimensions.get('window')` bounds to satisfy the viewport-overflow requirement.

**Rationale**: React Native has no `getBoundingClientRect` or CSS `position: fixed`. The standard pattern is `ref.measure(callback)` which returns `x, y, width, height, pageX, pageY` in screen coordinates. The tooltip is rendered via a `Modal` (with `transparent` and `visible` controlled by state) or an absolute `View` at the root layout level.

**Alternatives considered**:
- `@gorhom/bottom-sheet` or similar — too heavy for a tooltip
- `react-native-tooltip` third-party library — violates FR-012 (no new dependencies)
- Portal-based root overlay — simpler than Modal for this use case; avoids Modal's own animation system conflicting with Reanimated

---

## Finding 6: Animation — `react-native-reanimated` with `withTiming`

**Decision**: Animate tooltip opacity and scale using `useSharedValue` + `withTiming` from `react-native-reanimated`, matching the existing `AnimatedSlot.tsx` pattern (`Easing.out(Easing.cubic)`, ~200ms duration).

**Rationale**: `react-native-reanimated` is already installed and is the project's established animation library (`AchievementToast.tsx`, `AnimatedSlot.tsx` both use it). Using it keeps the animation on the UI thread (avoids JS bridge jank), and the `withTiming` + `Easing.out` pattern is already present in the codebase — no new patterns to introduce.

**Alternatives considered**:
- `Animated` from `react-native` core — older API, JS-thread, inconsistent with project convention
- CSS transitions — not applicable

---

## Finding 7: Accessibility in React Native

**Decision**: Use `accessibilityHint` on the trigger element (not `aria-describedby`, which is a web concept) and `accessibilityViewIsModal={false}` on the tooltip overlay. The tooltip text node should have `accessibilityRole="text"`.

**Rationale**: React Native's accessibility model uses `accessibilityLabel`, `accessibilityHint`, and `accessibilityRole` rather than ARIA attributes. `aria-describedby` does not exist in RN. Screen readers on iOS (VoiceOver) and Android (TalkBack) read `accessibilityHint` as supplementary context after the main label — which matches the tooltip's intent.

**Alternatives considered**:
- `aria-describedby` — web-only, not supported in React Native
- `accessibilityLabel` on wrapper — would override child's own label; use `accessibilityHint` instead

---

## Summary of Spec Adjustments Required

| Spec Item | Original (Web) | React Native Equivalent |
|-----------|---------------|------------------------|
| Mouse hover show/hide | `onMouseEnter`/`onMouseLeave` | `onLongPress` to show, auto-dismiss timeout or tap-away |
| CSS transitions | `transition: opacity 150ms` | `withTiming(1, { duration: 150 })` via reanimated |
| Viewport edge detection | `getBoundingClientRect` | `ref.measure()` + `Dimensions.get('window')` |
| ARIA `role="tooltip"` | HTML attribute | `accessibilityRole` / `accessibilityHint` |
| `aria-describedby` | HTML attribute | `accessibilityHint` on trigger |
| CSS co-located styles | `.css` file or CSS-in-JS | `StyleSheet.create()` at bottom of `.tsx` file |
| No layout shift | `position: absolute` + opacity | `position: 'absolute'` + opacity-only animation |
