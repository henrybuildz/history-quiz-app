# Tasks: Tooltip Component

**Input**: Design documents from `/specs/001-tooltip-component/`

**Platform note**: This is a React Native / Expo app. All tasks target `components/Tooltip.tsx`. No CSS file. Styles via `StyleSheet.create()`. Animation via `react-native-reanimated`. "Hover" = long-press. See `research.md` for full spec-to-RN mapping.

**Tests**: Not requested in spec. Validation is manual via Expo Simulator / device.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (no dependency on preceding incomplete task)
- **[Story]**: Which user story this task belongs to (US1–US4)
- All implementation tasks target `components/Tooltip.tsx` unless noted

---

## Phase 1: Setup

**Purpose**: Create the component file scaffold — the single deliverable file for this entire feature.

- [x] T001 Create `components/Tooltip.tsx`: add `TooltipProps` TypeScript interface (`label: string`, `children: React.ReactElement`, `placement?: 'top'|'bottom'`, `delayMs?: number`, `dismissAfterMs?: number`), export empty `Tooltip` component, and empty `StyleSheet.create({})` block

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core state and animation infrastructure that every user story builds on. **No story work can begin until this phase is complete.**

- [x] T002 Add internal state hooks: `const [visible, setVisible] = useState(false)`, `const [triggerLayout, setTriggerLayout] = useState<TriggerLayout | null>(null)`, `const [tooltipLayout, setTooltipLayout] = useState<TooltipSize | null>(null)` in `components/Tooltip.tsx`
- [x] T003 Add `triggerRef = useRef<View>(null)` and stable `tooltipId = useId()` (or `useRef(uuid)`) for ARIA/accessibility wiring in `components/Tooltip.tsx`
- [x] T004 Add `react-native-reanimated` animated opacity: `const opacity = useSharedValue(0)` and `const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))` in `components/Tooltip.tsx`
- [x] T005 Implement `showTooltip()` callback: call `triggerRef.current?.measure((x, y, w, h, pageX, pageY) => { setTriggerLayout({...}); setVisible(true); opacity.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.cubic) }) })` in `components/Tooltip.tsx`

**Checkpoint**: Foundation ready — state, ref, animation value, and show trigger are wired. User story work can now begin.

---

## Phase 3: User Story 1 — Basic Long-Press Show/Dismiss (Priority: P1) 🎯 MVP

**Goal**: Wrapping any element with `<Tooltip label="...">` makes a floating label appear on long-press and auto-dismiss after a timeout.

**Independent Test**: Long-press a `<Tooltip label="Hello"><Pressable>...</Pressable></Tooltip>` in the simulator — label appears above the element and auto-dismisses after ~2.5s with a smooth fade.

- [x] T006 [US1] Implement `hideTooltip()` callback: `opacity.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) })` followed by `runOnJS(setVisible)(false)` in `components/Tooltip.tsx`
- [x] T007 [US1] Implement auto-dismiss: inside `showTooltip()`, store `setTimeout(hideTooltip, dismissAfterMs ?? 2500)` in a `dismissTimerRef = useRef<ReturnType<typeof setTimeout>>()` and cancel on each new show and on `useEffect` cleanup in `components/Tooltip.tsx`
- [x] T008 [US1] Render trigger: return `<View ref={triggerRef}><Pressable onLongPress={showTooltip} delayLongPress={delayMs ?? 500}>{children}</Pressable></View>` (outer `View` holds the ref for `measure()`) in `components/Tooltip.tsx`
- [x] T009 [US1] Render tooltip bubble: when `visible`, render `<Animated.View style={[styles.bubble, animStyle, { top: computedTop, left: computedLeft }]}><Text style={styles.label}>{label}</Text></Animated.View>` positioned absolutely in `components/Tooltip.tsx`
- [x] T010 [US1] Apply `StyleSheet.create()` bubble styles using project tokens from `constants/theme.ts`: `backgroundColor: Colors.surface`, `borderRadius: Radius.md`, `paddingVertical: Spacing.xs`, `paddingHorizontal: Spacing.sm`, `zIndex: 9999`, shadow matching `AchievementToast.tsx` pattern in `components/Tooltip.tsx`
- [ ] T011 [US1] Manually validate SC-1 in Expo Simulator: long-press wrapped element → tooltip fades in smoothly (no jump) → auto-dismisses after ~2.5s → no layout shift in surrounding elements

**Checkpoint**: User Story 1 fully functional — basic tooltip show/dismiss works independently.

---

## Phase 4: User Story 2 — Press Passthrough (Priority: P1)

**Goal**: Short-tapping the wrapped element fires its `onPress` handler exactly once. The tooltip `Pressable` wrapper must never intercept or delay short taps.

**Independent Test**: Wrap a counter `Pressable` in `Tooltip` — short-tap increments the counter; no tooltip appears. Long-press shows the tooltip; the counter does not change.

- [x] T012 [US2] Confirm the trigger `Pressable` (T008) has **no `onPress` handler** — only `onLongPress`. Verify in Expo Simulator that short-tapping the wrapped child fires the child's own `onPress` without interference in `components/Tooltip.tsx`
- [ ] T013 [US2] If React Native's nested `Pressable` conflict is observed (child `onPress` suppressed during long-press detection): switch trigger wrapper from `Pressable` to `View` with `react-native-gesture-handler` `LongPressGestureHandler`, preserving the child's own `Pressable` untouched in `components/Tooltip.tsx`
- [ ] T014 [US2] Manually validate SC-2 and SC-3: (a) short-tap wrapped button increments counter with zero tooltip interference; (b) long-press shows tooltip and counter stays unchanged; (c) tap while tooltip is visible increments counter and dismisses tooltip

**Checkpoint**: User Stories 1 and 2 both fully functional and independently testable.

---

## Phase 5: User Story 3 — Viewport Edge Repositioning (Priority: P2)

**Goal**: Tooltip label never overflows any screen edge. Default position is above-and-centered; it auto-flips below when insufficient space above, and clamps horizontally when near left/right edges.

**Independent Test**: Position a `Tooltip`-wrapped element at the right edge, left edge, and top of the screen in the simulator — in all cases the tooltip bubble is fully visible within the safe area.

- [x] T015 [US3] Add `onLayout` on the tooltip `Animated.View` bubble: `onLayout={(e) => setTooltipLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}` in `components/Tooltip.tsx`
- [x] T016 [US3] Implement `computeTooltipPosition(trigger, tooltip, window)` pure function in `components/Tooltip.tsx`: initial `left = trigger.pageX + trigger.width / 2 - tooltip.width / 2`; initial `top = trigger.pageY - tooltip.height - 8` (8px gap); return `{ top, left, actualPlacement: 'top' }`
- [x] T017 [US3] Add horizontal clamping in `computeTooltipPosition()`: `left = Math.max(8, Math.min(left, windowWidth - tooltip.width - 8))` in `components/Tooltip.tsx`
- [x] T018 [US3] Add vertical flip in `computeTooltipPosition()`: `if (top < 0) { top = trigger.pageY + trigger.height + 8; actualPlacement = 'bottom' }` in `components/Tooltip.tsx`
- [x] T019 [US3] Wire `computeTooltipPosition()` into `showTooltip()`: call it after `setTriggerLayout()` using `Dimensions.get('window')` for window dimensions; store result in component state for the bubble's `top`/`left` styles in `components/Tooltip.tsx`
- [ ] T020 [US3] Manually validate SC-4: use Expo Simulator to place wrapped elements at right edge, left edge, and top edge — confirm tooltip is never clipped on any edge

**Checkpoint**: User Stories 1, 2, and 3 fully functional. Tooltip is safe across all screen positions.

---

## Phase 6: User Story 4 — Screen Reader Accessibility (Priority: P2)

**Goal**: VoiceOver (iOS) and TalkBack (Android) users hear the tooltip label as a hint when navigating to the wrapped element, without requiring a long-press.

**Independent Test**: Enable VoiceOver in the iOS Simulator, swipe to the wrapped element — confirm the screen reader announces the element's accessible name followed by the tooltip label as a hint.

- [x] T021 [US4] Add `accessibilityHint={label}` to the trigger wrapper `View` (or `Pressable`) so VoiceOver/TalkBack reads the tooltip text as a supplemental hint in `components/Tooltip.tsx`
- [x] T022 [US4] Add `importantForAccessibility="no"` (Android) and `accessibilityElementsHidden={true}` (iOS) to the tooltip bubble `Animated.View` overlay — prevents double-announcement of the label by the screen reader in `components/Tooltip.tsx`
- [ ] T023 [US4] Manually validate SC-5: enable VoiceOver on iOS Simulator, navigate to a wrapped Pressable — screen reader announces element label AND the tooltip hint; no duplicate announcement

**Checkpoint**: All 4 user stories complete. Component is production-ready.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Edge case hardening and accessibility motion preferences that affect all stories.

- [x] T024 Guard empty `label`: add `if (__DEV__ && !label) console.warn('[Tooltip] label prop is empty — tooltip will render with no text')` at the top of the component body in `components/Tooltip.tsx`
- [x] T025 Cancel stale timeout on rapid show/hide: ensure `clearTimeout(dismissTimerRef.current)` is called at the top of both `showTooltip()` and `hideTooltip()`, and inside the `useEffect` return cleanup in `components/Tooltip.tsx`
- [x] T026 Add reduced-motion support: use `AccessibilityInfo.isReduceMotionEnabled()` (imported from `react-native`) — if true, set `withTiming` `duration` to `0` in both `showTooltip()` and `hideTooltip()` in `components/Tooltip.tsx`
- [ ] T027 Run all 6 quickstart.md validation scenarios (SC-1 through SC-6) end-to-end in Expo Simulator and confirm all pass before marking feature complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — first story to implement
- **US2 (Phase 4)**: Depends on Phase 3 (needs working trigger `Pressable` from T008)
- **US3 (Phase 5)**: Can start after Phase 2 — independent of US2
- **US4 (Phase 6)**: Can start after Phase 2 — independent of US2 and US3
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2)
- **US2 (P1)**: Depends on US1 (needs working `Pressable` wrapper from T008)
- **US3 (P2)**: Depends on Foundational (Phase 2) only — can proceed in parallel with US2
- **US4 (P2)**: Depends on Foundational (Phase 2) only — can proceed in parallel with US2 and US3

### Within Each Phase

- State setup (T002–T005) before any rendering tasks
- Rendering tasks (T008–T010) before validation tasks (T011)
- `computeTooltipPosition()` function (T016) before wiring it in (T019)

---

## Parallel Opportunities

```
After Phase 2 completes:
  Track A: US1 (T006–T011) → US2 (T012–T014)
  Track B: US3 (T015–T020)       [independent of US2]
  Track C: US4 (T021–T023)       [independent of US2 and US3]

All three tracks can converge at Phase 7 (T024–T027)
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T005) — **critical, blocks everything**
3. Complete Phase 3: User Story 1 (T006–T011)
4. **STOP and VALIDATE**: Long-press any wrapped element — tooltip appears, auto-dismisses, no layout shift
5. Complete Phase 4: User Story 2 (T012–T014)
6. **STOP and VALIDATE**: Short-tap fires `onPress`; long-press shows tooltip; both work independently
7. Deploy/demo if ready

### Incremental Delivery

1. Phases 1–2 → Foundation ready
2. Phase 3 → Basic tooltip works (MVP)
3. Phase 4 → Click passthrough confirmed
4. Phases 5–6 → Edge repositioning + accessibility
5. Phase 7 → Polish complete, full validation

---

## Notes

- All 25 implementation tasks target `components/Tooltip.tsx` — the entire feature lives in one file
- `[P]` is not used here since all tasks share the same file; Track A/B/C above shows where parallel team work is possible across separate working branches
- Validation tasks (T011, T014, T020, T023, T027) require Expo Simulator or physical device — they cannot be validated by static analysis
- Import project design tokens from `constants/theme.ts` (`Colors`, `Spacing`, `Radius`) to match `AchievementToast.tsx` visual style
- `react-native-reanimated` is already installed — no `npx expo install` needed
