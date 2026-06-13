# Quickstart & Validation Guide: Achievement Notification Stack

**Feature**: 002-achievement-toast-stack | **Date**: 2026-06-12

---

## Prerequisites

- Expo dev server running (`npx expo start`)
- iOS Simulator or physical device (Android also supported)
- A signed-in user account (achievements require an authenticated session)

---

## Component locations

```
stores/achievementStore.ts      ← state layer (modified)
hooks/useAchievements.ts        ← consumer API (new)
components/AchievementToast.tsx ← overlay renderer (rewritten)
```

No routing changes. No migrations. `<AchievementToast />` is already mounted in `app/_layout.tsx`.

---

## Triggering notifications manually (dev testing)

During development, inject toasts directly from any screen using the global store. Add this to a `useEffect` or button handler in any component:

```ts
import { useAchievementStore } from '../stores/achievementStore';

// Trigger 1 toast
useAchievementStore.getState().enqueueToasts(['quiz_1']);

// Trigger 3 simultaneous toasts (stacking test)
useAchievementStore.getState().enqueueToasts(['quiz_1', 'perfect_1', 'streak_5']);

// Trigger 6 toasts (queue overflow test — only 5 visible at once)
useAchievementStore.getState().enqueueToasts(['quiz_1', 'perfect_1', 'streak_5', 'level_2', 'score_1k', 'era_rome']);

// Clear all (reset between tests)
useAchievementStore.getState().clearAll();
```

---

## Validation Scenarios

### SC-1: Single card — appear, hold, auto-dismiss

1. Trigger: `enqueueToasts(['quiz_1'])`
2. **Expected**: Card slides in from the right edge into the top-right corner. Displays "✍️ First Chronicle" with description and "+10 🪙".
3. Wait 4 seconds.
4. **Expected**: Card slides back out to the right edge and disappears completely.
5. **Expected**: No other element on screen shifted position at any point.

---

### SC-2: Stacked cards — independent timers, reposition on dismiss

1. Trigger: `enqueueToasts(['quiz_1', 'perfect_1', 'streak_5'])`
2. **Expected**: All 3 cards appear stacked vertically in the top-right corner. `quiz_1` is topmost (index 0), `perfect_1` below it, `streak_5` below that.
3. After ~4 seconds, `quiz_1` auto-dismisses.
4. **Expected**: `perfect_1` and `streak_5` smoothly slide upward to fill the gap within 250ms.
5. After another ~4 seconds, `perfect_1` auto-dismisses; `streak_5` slides up.
6. After another ~4 seconds, `streak_5` auto-dismisses. Overlay is empty.

---

### SC-3: Manual tap dismiss

1. Trigger: `enqueueToasts(['level_2', 'score_1k'])`
2. **Expected**: 2 cards appear stacked.
3. Tap the top card (`level_2`) before its 4-second timer expires.
4. **Expected**: The tapped card slides out immediately. `score_1k` slides upward to index 0.
5. Verify `score_1k` continues its own timer and auto-dismisses after its original 4 seconds (not reset by the tap above it).

---

### SC-4: Queue overflow — more than 5 simultaneous

1. Trigger: `enqueueToasts(['quiz_1', 'perfect_1', 'streak_5', 'level_2', 'score_1k', 'era_rome'])`
2. **Expected**: Exactly 5 cards visible. `era_rome` does NOT appear yet.
3. Wait for `quiz_1` to auto-dismiss.
4. **Expected**: `era_rome` slides in as the new 5th card (bottom of visible stack). The 4 remaining visible cards do NOT reposition (they stay put; the new card fills the newly available slot below them).

---

### SC-5: Layout isolation

1. Navigate to the quiz tab. Start a quiz.
2. In a separate test build, trigger: `enqueueToasts(['quiz_1'])`
3. Observe the quiz question and answer buttons while the card appears, holds, and dismisses.
4. **Expected**: Question text, answer slots, score display, and hearts do not shift position at any point during the card's lifecycle.

---

### SC-6: Reduced motion

1. On iOS Simulator: Settings → Accessibility → Motion → Reduce Motion → ON
2. Trigger: `enqueueToasts(['quiz_1'])`
3. **Expected**: Card appears instantly (no slide animation). Holds for 4 seconds. Disappears instantly.
4. Trigger: `enqueueToasts(['quiz_1', 'perfect_1'])`
5. Tap top card to dismiss.
6. **Expected**: Both appear instantly. Top card vanishes instantly on tap. Second card repositions instantly.

---

### SC-7: Deduplication

1. Trigger: `enqueueToasts(['quiz_1'])`  — card appears.
2. Before it dismisses, trigger: `enqueueToasts(['quiz_1'])` again.
3. **Expected**: No second card appears. The original card continues on its timer unaffected.
4. After first card dismisses, trigger: `enqueueToasts(['quiz_1'])` a third time.
5. **Expected**: Still no card — `quiz_1` is in `unlockedIds` and is permanently deduplicated for this session.

---

### SC-8: Screen reader accessibility (VoiceOver)

1. Enable VoiceOver on iOS Simulator (Cmd+F5).
2. Trigger: `enqueueToasts(['perfect_1'])`
3. **Expected**: VoiceOver announces "Achievement unlocked: Flawless. Finish a quiz without a wrong answer." automatically (live region, polite).
4. No manual focus or swipe needed to hear the announcement.

---

## Integration test: Live quiz flow

1. Start a quiz, answer all questions correctly on the first attempt.
2. On the results modal, tap "Home".
3. **Expected**: After the modal closes and the home screen is visible, achievement cards appear for any newly unlocked achievements (e.g. `quiz_1` on first ever quiz, `perfect_1` for a perfect run).
4. Verify the cards show correct data (icon, name, coin reward matching `lib/achievements.ts`).

---

## Key constants (for verification)

| Constant | Value | Where |
|----------|-------|-------|
| `MAX_VISIBLE` | 5 | `components/AchievementToast.tsx` |
| `CARD_WIDTH` | 280 | `components/AchievementToast.tsx` |
| `CARD_HEIGHT` | 76 | `components/AchievementToast.tsx` |
| `CARD_GAP` | 8 | `components/AchievementToast.tsx` |
| `DISMISS_DELAY_MS` | 4000 | `components/AchievementToast.tsx` |
| `SLIDE_IN_MS` | 280 | `components/AchievementToast.tsx` |
| `SLIDE_OUT_MS` | 220 | `components/AchievementToast.tsx` |
| `REPOSITION_MS` | 250 | `components/AchievementToast.tsx` |
