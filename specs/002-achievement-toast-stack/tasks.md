# Tasks: Achievement Notification Stack

**Input**: Design documents from `specs/002-achievement-toast-stack/`

**Platform note**: React Native / Expo SDK 56. All animation via `react-native-reanimated` v3. State via Zustand v5. No CSS — styles via `StyleSheet.create()`. No new dependencies required.

**Tests**: Not requested. Validation is manual via Expo Simulator / device (see `quickstart.md`).

**Organization**: Tasks grouped by user story. Each story is independently testable before the next begins.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete task)
- **[Story]**: Which user story this task belongs to (US1–US3)
- All implementation tasks include the exact file to modify

---

## Phase 1: Setup

**Purpose**: Establish the `hooks/` directory that does not yet exist in the project.

- [x] T001 Create `hooks/` directory at project root by creating the file `hooks/useAchievements.ts` with a single placeholder export: `export {}` — this establishes the import path before any consumer references it

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Store and hook changes that every user story builds on. **No component work can begin until this phase is complete.**

- [x] T002 [P] In `stores/achievementStore.ts`: (1) replace `dismissToast(): void` in the `AchievementStore` interface with `dismissToastByKey(key: number): void`; (2) remove the `dismissToast` implementation from the store factory; (3) add `dismissToastByKey` implementation: `set(s => { if (s.toastQueue.length === 0) return s; const next = s.toastQueue.filter(item => item.key !== key); if (next.length === s.toastQueue.length) return s; return { toastQueue: next }; })`

- [x] T003 [P] In `hooks/useAchievements.ts` (replacing the T001 placeholder): implement `useAchievements()` as a named export — a single `useAchievementStore` selector returning `{ enqueueToasts: s.enqueueToasts, unlockedIds: s.unlockedIds }`; add TypeScript return type annotation; import `useAchievementStore` from `../stores/achievementStore`

**Checkpoint**: Store exposes `dismissToastByKey`. Hook exposes the public consumer API. Component work can now begin.

---

## Phase 3: User Story 1 — Single Achievement Card (Priority: P1) 🎯 MVP

**Goal**: One achievement card slides in from the right edge of the screen, displays icon + name + description + coin reward, holds for 4 seconds, then slides back out. No other element on screen shifts.

**Independent Test**: Call `useAchievementStore.getState().enqueueToasts(['quiz_1'])` from any screen. Verify SC-1 from `quickstart.md`.

- [x] T004 [US1] In `components/AchievementToast.tsx`, add all module-level constants immediately after imports: `MAX_VISIBLE = 5`, `CARD_WIDTH = 280`, `CARD_HEIGHT = 76`, `CARD_GAP = 8` (= `Spacing.sm`), `CARD_RIGHT = 16` (= `Spacing.md`), `OFFSCREEN_X = CARD_WIDTH + CARD_RIGHT + 8`, `DISMISS_DELAY_MS = 4000`, `SLIDE_IN_MS = 280`, `SLIDE_OUT_MS = 220`, `REPOSITION_MS = 250`; add easing constants `EASING_OUT = Easing.out(Easing.cubic)` and `EASING_IN = Easing.in(Easing.cubic)` allocated once at module scope (same pattern as `components/AnimatedSlot.tsx`); add `type AchievementCardProps = { toast: ToastItem; index: number; insets: EdgeInsets; onDismiss: () => void }` (import `EdgeInsets` from `react-native-safe-area-context`)

- [x] T005 [US1] In `components/AchievementToast.tsx`, add the internal `AchievementCard` function component (not exported) with static layout only — no animation yet: return a `View` with `styles.card` containing: (1) `<Text style={styles.icon} accessible={false}>{toast.def.icon}</Text>`, (2) `<View style={styles.textBlock}><Text style={styles.name} numberOfLines={1}>{toast.def.name}</Text><Text style={styles.desc} numberOfLines={1}>{toast.def.description}</Text></View>`, (3) conditional `{toast.def.rewardCoins > 0 && <Text style={styles.coins} accessible={false}>+{toast.def.rewardCoins} 🪙</Text>}`; add `styles.card`: `position: 'absolute'`, `right: CARD_RIGHT`, `width: CARD_WIDTH`, `flexDirection: 'row'`, `alignItems: 'center'`, `backgroundColor: Colors.surface`, `borderWidth: 1.5`, `borderColor: Colors.gold`, `borderRadius: Radius.lg`, `paddingVertical: Spacing.sm`, `paddingHorizontal: Spacing.md`, `gap: Spacing.sm`, `zIndex: 9999`, `elevation: 20`, shadows matching existing card (`shadowColor: '#000'`, `shadowOffset: { width: 0, height: 4 }`, `shadowOpacity: 0.18`, `shadowRadius: 8`)

- [x] T006 [US1] In `components/AchievementToast.tsx`, convert `AchievementCard`'s returned `View` to `Animated.View` and wire the horizontal slide animation: add `const translateX = useSharedValue(OFFSCREEN_X)`; add `const animStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }))`; add `const mountedRef = useRef(true)` and `const dismissingRef = useRef(false)` and `const autoTimerRef = useRef<ReturnType<typeof setTimeout>>()`; add a `useEffect` (deps `[]`) that fires entry animation: `translateX.value = withTiming(0, { duration: SLIDE_IN_MS, easing: EASING_OUT })`; apply `animStyle` to the `Animated.View` alongside `styles.card`

- [x] T007 [US1] In `components/AchievementToast.tsx`, add vertical positioning to `AchievementCard` via a second shared value: add `const topAnim = useSharedValue(insets.top + Spacing.sm + index * (CARD_HEIGHT + CARD_GAP))`; expand `useAnimatedStyle` to also return `top: topAnim.value` (alongside `transform`); remove any hardcoded `top` from `styles.card` (top is driven entirely by `topAnim`)

- [x] T008 [US1] In `components/AchievementToast.tsx`, add auto-dismiss timer and cleanup to `AchievementCard`'s mount `useEffect`: after starting the entry animation, set `autoTimerRef.current = setTimeout(() => { if (!mountedRef.current || dismissingRef.current) return; dismissingRef.current = true; translateX.value = withTiming(OFFSCREEN_X, { duration: SLIDE_OUT_MS, easing: EASING_IN }, () => runOnJS(onDismiss)()) }, DISMISS_DELAY_MS)`; add cleanup return: `() => { mountedRef.current = false; clearTimeout(autoTimerRef.current); cancelAnimation(translateX); cancelAnimation(topAnim) }`; import `cancelAnimation` and `runOnJS` from `react-native-reanimated`

- [x] T009 [US1] In `components/AchievementToast.tsx`, rewrite the exported `AchievementToast` root component entirely: read `const queue = useAchievementStore(s => s.toastQueue)` and `const dismissToastByKey = useAchievementStore(s => s.dismissToastByKey)`; read `const insets = useSafeAreaInsets()`; return `null` when `queue.length === 0`; otherwise return a fragment rendering `queue.slice(0, MAX_VISIBLE).map((toast, index) => <AchievementCard key={toast.key} toast={toast} index={index} insets={insets} onDismiss={() => dismissToastByKey(toast.key)} />)`; remove all old `animatingKey`, `translateY`, `withSequence`, `withDelay` logic

- [x] T010 [US1] In `components/AchievementToast.tsx`, update the `StyleSheet`: remove the old `container` style (full-width, `left/right` anchored, `translateY`-based); keep and update `icon` (fontSize: 32), `textBlock` (flex: 1, gap: 2), `header` (remove — not in new design), `name` (Cinzel-Bold, 14px, `Colors.textPrimary`), `desc` (11px, `Colors.textMuted`, lineHeight: 14), `coins` (Cinzel-Bold, 14px, `Colors.gold`); ensure `styles.card` from T005 is the sole container style

- [ ] T011 [US1] Manually validate SC-1 from `quickstart.md`: inject `useAchievementStore.getState().enqueueToasts(['quiz_1'])` in a dev `useEffect`; confirm card slides in from right edge, displays "✍️", "First Chronicle", its description, and "+10 🪙"; confirm 4-second auto-dismiss with right-edge slide-out; confirm no layout shift anywhere on screen

**Checkpoint**: User Story 1 complete — single card lifecycle works end-to-end.

---

## Phase 4: User Story 2 — Stacked Multiple Notifications (Priority: P2)

**Goal**: Multiple cards stack vertically in the top-right corner with independent timers. When any card dismisses, the cards below it animate upward within 250ms.

**Independent Test**: Trigger 3 simultaneous toasts and validate SC-2 from `quickstart.md`.

- [x] T012 [US2] In `components/AchievementToast.tsx`, add reposition animation to `AchievementCard`: add a second `useEffect` with `[index]` as the dependency; inside it, compute `newTop = insets.top + Spacing.sm + index * (CARD_HEIGHT + CARD_GAP)` and run `topAnim.value = withTiming(newTop, { duration: REPOSITION_MS, easing: EASING_OUT })`; guard against the initial mount by adding `const hasMountedRef = useRef(false)` — set it `true` in the mount `useEffect` (after entry animation starts) and check `if (!hasMountedRef.current) return` at the top of the index-change `useEffect` so the first render does not trigger an animated reposition (the T007 immediate assignment already set the correct initial `top`)

- [ ] T013 [US2] Manually validate SC-2 from `quickstart.md`: trigger `enqueueToasts(['quiz_1', 'perfect_1', 'streak_5'])`; verify 3 cards appear stacked top-right, non-overlapping; wait for `quiz_1` to auto-dismiss; verify `perfect_1` and `streak_5` slide upward within 250ms; wait for remaining cards to dismiss sequentially

**Checkpoint**: User Stories 1 and 2 complete — stacking and reposition work.

---

## Phase 5: User Story 3 — Manual Early Dismiss (Priority: P3)

**Goal**: Tapping a card immediately starts its exit animation and cancels its auto-dismiss timer.

**Independent Test**: Show 2 stacked cards, tap the top one before 4 seconds, and validate SC-3 from `quickstart.md`.

- [x] T014 [US3] In `components/AchievementToast.tsx`, add tap-to-dismiss to `AchievementCard`: wrap the `Animated.View` in a `Pressable` (make `Pressable` the outermost element of `AchievementCard`'s return); add `onPress` handler: `if (dismissingRef.current) return; dismissingRef.current = true; clearTimeout(autoTimerRef.current); translateX.value = withTiming(OFFSCREEN_X, { duration: SLIDE_OUT_MS, easing: EASING_IN }, () => runOnJS(onDismiss)())`; ensure `Pressable` receives no `style` prop (layout and position come from `Animated.View`'s `animStyle` + `styles.card`); add `android_ripple={{ color: 'transparent' }}` to suppress double-ripple on Android

- [ ] T015 [US3] Manually validate SC-3 from `quickstart.md`: trigger 2 cards; tap the top card before its timer; verify immediate slide-out; verify the second card repositions; verify the second card's timer fires independently ~4 seconds after it first appeared

**Checkpoint**: All 3 user stories complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Accessibility and reduced-motion support that cut across all user stories.

- [x] T016 In `components/AchievementToast.tsx`, add reduced-motion support to `AchievementCard`: add `const reduceMotionRef = useRef(false)`; in the mount `useEffect`, call `AccessibilityInfo.isReduceMotionEnabled().then(v => { reduceMotionRef.current = v }).catch(() => {})`; wrap all `withTiming` duration values: `duration: reduceMotionRef.current ? 0 : SLIDE_IN_MS` (entry), `duration: reduceMotionRef.current ? 0 : SLIDE_OUT_MS` (exit in timer and tap handler), `duration: reduceMotionRef.current ? 0 : REPOSITION_MS` (reposition); import `AccessibilityInfo` from `react-native`

- [x] T017 In `components/AchievementToast.tsx`, add accessibility attributes to `AchievementCard`: on the outermost element (`Pressable` from T014 or `Animated.View` if T014 not yet done), add `accessibilityLiveRegion="polite"`, `accessibilityRole="alert"`, `accessibilityLabel={\`Achievement unlocked: ${toast.def.name}. ${toast.def.description}\`}`; ensure all inner `Text` nodes already have `accessible={false}` (icon and coins) or leave name/desc Text nodes without `accessible={false}` since the parent label covers them via `accessibilityLabel`

- [ ] T018 Manually validate SC-4 (queue overflow — trigger 6 toasts, verify only 5 visible; dismiss one, verify 6th appears) and SC-5 (layout isolation — trigger a card during an active quiz, verify quiz elements do not shift) from `quickstart.md`

- [ ] T019 Manually validate SC-6 (reduced motion — enable Reduce Motion in Simulator settings, trigger cards, verify instant appear/disappear), SC-7 (deduplication — queue same ID twice, verify single card), and SC-8 (VoiceOver — enable VoiceOver, trigger a card, verify automatic announcement) from `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T003 needs the `hooks/` directory from T001) — **BLOCKS all component work**
- **US1 (Phase 3)**: Depends on Phase 2 (component needs `dismissToastByKey` from T002)
- **US2 (Phase 4)**: Depends on Phase 3 — reposition only meaningful once single card works
- **US3 (Phase 5)**: Depends on Phase 3 — tap handler added to existing card structure
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2)
- **US2 (P2)**: Depends on US1 — same file, extends existing `AchievementCard`
- **US3 (P3)**: Depends on US1 — same file, wraps existing `AchievementCard` layout

### Within Each Phase

- T002 and T003 are in different files → run in parallel [P]
- T004–T010 are all in `components/AchievementToast.tsx` → sequential
- T012 is in `components/AchievementToast.tsx` → sequential after T010
- T014 is in `components/AchievementToast.tsx` → sequential after T012
- T016 and T017 are in `components/AchievementToast.tsx` → sequential after T015

---

## Parallel Opportunities

```
Phase 2 (both run simultaneously):
  T002 → stores/achievementStore.ts
  T003 → hooks/useAchievements.ts

Phase 3 → Phase 4 → Phase 5 (sequential, same file):
  T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011
                                                       ↓
                                                  T012 → T013
                                                       ↓
                                                  T014 → T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T003) — run in parallel
3. Complete Phase 3: User Story 1 (T004–T011) — sequential, same file
4. **STOP and VALIDATE**: Trigger one achievement, confirm SC-1 passes
5. Ship if single-card behavior is sufficient for the current milestone

### Incremental Delivery

1. Phases 1–2 → Foundation ready
2. Phase 3 → Single card works (MVP)
3. Phase 4 → Stacking works
4. Phase 5 → Tap dismiss works
5. Phase 6 → Accessibility + reduced motion (production-ready)

---

## Notes

- `AchievementToast.tsx` is a complete rewrite — the file import path and export name are unchanged; `app/_layout.tsx` requires no edits
- `app/quiz/[era].tsx` requires no edits — it calls `useAchievementStore.getState().enqueueToasts()` which is unchanged
- The `hooks/useAchievements.ts` hook is additive — no existing caller is changed
- Validation tasks (T011, T013, T015, T018, T019) require Expo Simulator or physical device
- `hasMountedRef` in T012 prevents an animated reposition on first render, matching the pattern in `app/(tabs)/profile.tsx`
- All easing constants (`EASING_IN`, `EASING_OUT`) are allocated once at module scope, matching `AnimatedSlot.tsx`
