---
name: project-achievements-wip
description: Achievement system implementation state — all files touched, all bugs found and fixed across 4 RRR cycles
metadata:
  type: project
---

# Achievement System — Session State (2026-06-07)

## Status: ~95% complete. One SQL edit was interrupted mid-session.

---

## What is DONE and on disk (reviewed 4×, production-ready)

### Migrations (supabase/migrations/)
- `20260608_achievements_schema.sql` — tables, indexes, RLS, seed (26 achievements). Clean.
- `20260608_save_quiz_session_v3.sql` — Extended RPC. **One edit was interrupted** (see OUTSTANDING below).

### TypeScript / React Native
- `lib/achievements.ts` — TS catalog mirror. Clean.
- `lib/supabase.ts` — `saveQuizResult` extended with `maxStreak/perfect/livesRemaining`, returns `newlyUnlocked`. `getUnlockedAchievements` added.
- `stores/achievementStore.ts` — Zustand store with `setUnlocked`, `enqueueToasts`, `dismissToast`, `clearAll`. All reviewed and fixed.
- `stores/quizStore.ts` — `currentStreak` and `maxStreak` tracked in `selectAnswer`.
- `components/AchievementToast.tsx` — NEW FILE. Animated overlay, slides from top, queues sequentially, correct Reanimated UI/JS thread split.
- `app/_layout.tsx` — `<AchievementToast />` mounted after `<Stack>`.
- `app/quiz/[era].tsx` — `persistResult` passes streak/perfect/lives, stores `newlyUnlocked` in `pendingToastsRef` (NOT enqueued immediately — modal is native layer), flushes on `handlePlayAgain` / `handleHome`. Both handlers now async with `withTimeout` await + double-invocation guards (`playingAgainRef`, `homeNavigatingRef`).
- `app/(tabs)/profile.tsx` — Achievement grid (4-col, locked=dimmed, secret=🔒/???, count in header), `achievementsLoading` state, `clearAllAchievements()` on sign-out.

---

## OUTSTANDING — One interrupted SQL edit

**File:** `supabase/migrations/20260608_save_quiz_session_v3.sql`

**What's on disk right now (INCOMPLETE):**
- `v_era_real_count BIGINT` has been added to the DECLARE block ✅
- Step 3 SELECT has been extended to compute `COUNT(DISTINCT era) FILTER (WHERE era != 'Mixed')` INTO `v_era_real_count` ✅
- The CTE still has the OLD subqueries for era_10 and era_all — NOT yet replaced ❌

**The edit that was interrupted — apply this to the CTE:**

Find this block:
```sql
      -- Both era_10 and era_all exclude 'Mixed': it is a play mode, not a real
      -- era, and storing it in quiz_sessions as a distinct value would let a
      -- single Mixed session count toward "10 different eras."
      OR (a.id = 'era_10' AND (
            SELECT COUNT(DISTINCT era) FROM quiz_sessions
            WHERE user_id = p_user_id AND era != 'Mixed'
          ) >= 10)
      OR (a.id = 'era_all' AND (
            SELECT COUNT(DISTINCT era) FROM quiz_sessions
            WHERE user_id = p_user_id AND era != 'Mixed'
          ) >= 30)
```

Replace with:
```sql
      -- Both use v_era_real_count (cached in Step 3, excludes 'Mixed') so no
      -- redundant subquery scans fire inside the CTE for these two achievements.
      OR (a.id = 'era_10'  AND v_era_real_count >= 10)
      OR (a.id = 'era_all' AND v_era_real_count >= 30)
```

**Why:** era_10 and era_all were issuing two identical `COUNT(DISTINCT era) FILTER (WHERE era != 'Mixed')` subqueries inside the MATERIALIZED CTE. Moving the count to Step 3 with PostgreSQL's `FILTER` clause computes it in one scan.

---

## Full list of bugs found and fixed across all 4 RRR cycles

### Round 1 (initial implementation review)
- **C**: `total_score + v_safe_score` integer overflow before LEAST → cast to BIGINT
- **C**: `selectAnswer` never updated `currentStreak`/`maxStreak` → fixed in quizStore
- **C**: `saveQuizResult` not passing `p_max_streak/p_perfect/p_lives_remaining`, not reading `out_newly_unlocked` → fixed
- **W**: `idx_user_achievements_user` redundant (PK covers it) — noted, not removed
- **W**: `era_all` hardcoded `>= 32` — impossible; fixed to `>= 30` with `Mixed` exclusion
- **W**: `p_max_streak/p_lives_remaining` no upper-bound validation → clamped
- **W**: `setUnlocked` equality check iterated raw `ids` array not the built Set → fixed

### Round 2 (UI implementation review)
- **C**: `AchievementToast` invisible behind `ResultsModal` (native Modal layer is above app root) → `pendingToastsRef` pattern, flush on modal close
- **W**: `iron_will` + `perfect_1` cheat combo via negative `p_lives_remaining` → `AND NOT p_perfect` guard
- **W**: Toast queue not cleared on sign-out → `clearAll()` action added to store
- **O**: Achievement grid flashes all-locked on first focus → `achievementsLoading` state

### Round 3 (post-modal-fix review)
- **C**: `handlePlayAgain` read `pendingToastsRef` synchronously before save resolved → made async, added `await withTimeout(savePromiseRef.current, ...)`
- **W**: `era_10` still counted 'Mixed' as valid era via `v_era_dist_count` → gave it own `era != 'Mixed'` subquery; removed dead `v_era_dist_count` variable

### Round 4 (current round)
- **C**: `handlePlayAgain` missing double-invocation guard → `playingAgainRef` added, reset in `fetchAndStart` ✅ FIXED
- **O**: `era_10` and `era_all` CTE subqueries identical — two index scans → `v_era_real_count` + FILTER approach — **INTERRUPTED, apply manually**

---

## Key architecture decisions (for context)

1. **Toasts fire after modal closes, not when save resolves.** Native `<Modal>` renders above the entire app root view. `zIndex` has no effect. Toasts are stored in `pendingToastsRef` and flushed in `handlePlayAgain` / `handleHome`.

2. **`savePromiseRef.current` is the chained promise** (result of `saveQuizResult(...).then(...)`). Awaiting it guarantees `persistResult`'s `.then()` has already run — `pendingToastsRef.current` is populated. This is why the async await in both handlers works correctly.

3. **`clearAll()` on sign-out clears both `unlockedIds` AND `toastQueue`** so a new user doesn't see stale achievements or toasts from the previous session.

4. **`p_perfect` is server-normalized**: `p_perfect := p_perfect AND (p_questions_correct = p_questions_answered)`. Prevents lying clients from earning `perfect_1` on non-perfect runs.

5. **`era_10` and `era_all` both exclude 'Mixed'**: storing 'Mixed' as an era in quiz_sessions would let one Mixed game count toward "10 different eras".
