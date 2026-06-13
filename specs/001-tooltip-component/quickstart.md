# Quickstart & Validation Guide: Tooltip Component

**Feature**: 001-tooltip-component | **Date**: 2026-06-12

---

## Prerequisites

- Expo dev server running (`npx expo start`)
- iOS Simulator or Android Emulator (or physical device via Expo Go)
- `react-native-reanimated` already installed (confirmed in package.json)

---

## Component Location

```
components/Tooltip.tsx   ← single file, styles co-located
```

No CSS file. No subdirectory. No barrel export needed — import directly.

---

## Basic Usage

```tsx
import { Tooltip } from '../components/Tooltip';

// Wrap any element — the child's onPress fires normally on short tap
<Tooltip label="Save your progress">
  <Pressable onPress={() => handleSave()}>
    <Text>Save</Text>
  </Pressable>
</Tooltip>
```

Long-press the "Save" button → tooltip appears above it → auto-dismisses after ~2.5s.

---

## Validation Scenarios

### SC-1: Basic show/dismiss (FR-001, FR-002, SC-001)

1. Navigate to any screen in the app
2. Render `<Tooltip label="Test label"><Pressable onPress={...}><Text>Press me</Text></Pressable></Tooltip>`
3. **Long-press** the element for ≥ 500ms
4. **Expected**: "Test label" appears above the element, fades in smoothly (~150ms)
5. Wait 2.5 seconds
6. **Expected**: Tooltip fades out and disappears

### SC-2: Click passthrough (FR-003, SC-003)

1. Add a counter `const [count, setCount] = useState(0)` and wrap a button: `<Tooltip label="Increment"><Pressable onPress={() => setCount(c => c + 1)}><Text>{count}</Text></Pressable></Tooltip>`
2. **Short-tap** the button (no long-press)
3. **Expected**: Counter increments; no tooltip appears
4. **Long-press** the button (tooltip shows), then **short-tap** the button while tooltip is visible
5. **Expected**: Counter increments; tooltip dismisses on the tap

### SC-3: Viewport edge clamping (FR-008, SC-004)

1. Render a `<Tooltip label="Near the edge">` wrapping an element positioned within 20px of the right screen edge
2. Long-press to show tooltip
3. **Expected**: The tooltip bubble is fully visible — not clipped by the screen edge; it shifts left automatically

4. Render a `<Tooltip label="Near top">` wrapping an element within 60px of the top safe area
5. Long-press to show
6. **Expected**: Tooltip renders **below** the element (auto-flips from `'top'` to `'bottom'` placement)

### SC-4: Accessibility (FR-009, SC-005)

1. Enable VoiceOver (iOS) or TalkBack (Android)
2. Focus the wrapped element using swipe navigation
3. **Expected**: Screen reader announces the element's label AND the tooltip label as a hint (e.g., "Save button. Hint: Save your progress.")
4. Inspect with Accessibility Inspector (Xcode) or Android Layout Inspector
5. **Expected**: `accessibilityHint` is set on the trigger element

### SC-5: Rapid long-press in/out (SC-006)

1. Long-press → tooltip shows → short-tap to dismiss → immediately long-press again, repeat 5×
2. **Expected**: No duplicate tooltips; no visual glitch; each show/hide completes cleanly

### SC-6: No layout shift (FR-007, SC-002)

1. Render a `<Tooltip>` wrapping a button inside a row of other buttons
2. Long-press to show tooltip, then dismiss
3. **Expected**: The surrounding buttons do not move; the layout is identical before and after the tooltip appears

---

## Key Implementation Notes (for task reference)

See [data-model.md](./data-model.md) for the full props interface and state machine.

- **Positioning**: Use `triggerRef.current.measure(callback)` to get `pageX, pageY, width, height`; compute tooltip `left` as `pageX + width/2 - tooltipWidth/2`, clamped to `[8, windowWidth - tooltipWidth - 8]`
- **Vertical flip**: If `pageY - tooltipHeight - gap < safeAreaTop` → render below (`pageY + height + gap`); otherwise render above (`pageY - tooltipHeight - gap`)
- **Animation**: `opacity` from 0→1 (show) and 1→0 (hide) using `withTiming` at 150ms and 120ms respectively; `react-native-reanimated` `useSharedValue`
- **No layout shift**: Tooltip is rendered in an absolute overlay (either via `Modal transparent` or a root-level absolute `View`); it is never in the document flow of the wrapped content
- **Accessibility**: Set `accessibilityHint={label}` on the trigger wrapper `Pressable`
