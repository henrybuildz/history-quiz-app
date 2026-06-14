# Tasks: Logout Preserve Progress

**Input**: Design documents from `/specs/004-logout-preserve-progress/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

**Tests**: Not requested — manual validation via quickstart.md

**Organization**: Tasks grouped by user story for independent delivery.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking deps)
- **[Story]**: User story label (US1, US2, US3)

---

## Phase 1: Foundational (Blocking Prerequisite)

**Purpose**: Create the `GuestSnapshot` module that all three user stories depend on. Must be complete before any story work begins.

**⚠️ CRITICAL**: All three user stories depend on this phase.

- [ ] T001 Create `lib/guestSnapshot.ts` with `GuestSnapshotData` interface (`{ version: 1, lives: number, coins: number, lastLifeLostAt: string | null }`) and three exported functions: `writeGuestSnapshot({ lives, coins })`, `readGuestSnapshot(): Promise<GuestSnapshotData | null>`, `clearGuestSnapshot(): void`. Use `expo-file-system/legacy` `FileSystem.documentDirectory` for `guest-snapshot.json`, mirroring the pattern in `lib/supabase.ts` (`_guestHeartsCache`, `_heartsPath`, `_writeGuestHearts`). Validate all fields on read; clamp lives to `[0, MAX_LIVES]`, clamp coins to `[0, ∞)`, reject invalid `lastLifeLostAt`. Import `MAX_LIVES` from `lib/supabase.ts`.

**Checkpoint**: `lib/guestSnapshot.ts` exists and exports all three functions. No other files changed yet.

---

## Phase 2: User Story 1 — Progress Survives Logout (Priority: P1) 🎯 MVP

**Goal**: Coins and lives visible before logout remain visible immediately after logout. The guest hearts cache is seeded from the snapshot instead of defaulting to MAX_LIVES.

**Independent Test**: Sign in, note coin + life counts, tap Log Out, reopen app as guest — values match. See quickstart.md Scenario 1.

- [ ] T002 [US1] Modify `app/(tabs)/profile.tsx` logout handler (around line 428): before `await signOut()`, call `writeGuestSnapshot({ lives: profile.lives, coins: profile.coins })` when `profile` is non-null. Import `writeGuestSnapshot` from `lib/guestSnapshot.ts`. Ensure the write is fire-and-forget (no await) so the UI stays responsive.

- [ ] T003 [US1] Modify `lib/supabase.ts` `_doInitGuestHearts()`: after the existing `try/catch` block (which reads `guest-hearts.json`), add a call to `readGuestSnapshot()`. If the snapshot is found AND `_guestHeartsCache.lives === MAX_LIVES` (meaning no `guest-hearts.json` existed or it was corrupt), override `_guestHeartsCache` with `{ lives: snapshot.lives, last_life_lost_at: snapshot.lastLifeLostAt }`. Import `readGuestSnapshot` from `lib/guestSnapshot.ts`.

**Checkpoint**: User Story 1 is fully functional. Log out → reopen app as guest → lives match the account value at logout. See quickstart.md Scenario 1 + Scenario 4 (restart persistence).

---

## Phase 3: User Story 2 — Guest Play Continues After Logout (Priority: P2)

**Goal**: Profile tab shows snapshot coin balance for guest users (not zero). Hearts continue to work correctly during guest quiz play (already handled by seeded cache from US1).

**Independent Test**: Log out, check profile tab shows correct coin count. Start a quiz, lose a heart — heart count decrements correctly. See quickstart.md Scenario 2.

- [ ] T004 [US2] Modify `app/(tabs)/profile.tsx` to display local coin + life counts for guest users. Add `guestSnapshot` state: `const [guestSnapshot, setGuestSnapshot] = useState<{ coins: number; lives: number } | null>(null)`. In the `useFocusEffect` callback, when `!hasUser`, call `readGuestSnapshot().then(s => setGuestSnapshot(s))`. Import `readGuestSnapshot` from `lib/guestSnapshot.ts`. In the stat items array, replace `profile?.coins ?? 0` with `hasUser ? (profile?.coins ?? 0) : (guestSnapshot?.coins ?? 0)` and `profile?.lives ?? 0` with `hasUser ? (profile?.lives ?? 0) : (guestSnapshot?.lives ?? 0)`.

**Checkpoint**: User Story 2 complete. Guest profile tab shows the coin and life values from logout, not zero. Hearts decrement correctly during quiz play (from seeded cache).

---

## Phase 4: User Story 3 — Re-login Restores Account State (Priority: P3)

**Goal**: Logging back in clears the guest snapshot so no guest values bleed into the account display.

**Independent Test**: Log out, log back in — account coin + life counts are shown (not guest values). See quickstart.md Scenario 3.

- [ ] T005 [US3] Modify `context/AuthContext.tsx` `onAuthStateChange` callback: when `session?.user` is non-null AND `!session.user.is_anonymous`, call `clearGuestSnapshot()`. Import `clearGuestSnapshot` from `lib/guestSnapshot.ts`. Place the call before `setSession(session)` to ensure the snapshot is cleared before any downstream re-render reads the new auth state.

**Checkpoint**: User Story 3 complete. Re-login shows account data; guest snapshot file is deleted. All three user stories are now functional.

---

## Phase 5: Polish & Edge Cases

**Purpose**: Error handling, edge case resilience, and final validation.

- [ ] T006 [P] In `lib/guestSnapshot.ts` `writeGuestSnapshot`: wrap the `FileSystem.writeAsStringAsync` call in `.catch(e => { if (__DEV__) console.warn('[GuestSnapshot] write failed:', e) })`. Ensure the function never throws — a storage failure must not crash the logout flow.

- [ ] T007 [P] In `lib/guestSnapshot.ts` `clearGuestSnapshot`: use `FileSystem.deleteAsync(path, { idempotent: true })` and swallow errors with `.catch(() => {})`. Idempotent delete means calling it when no file exists is a no-op.

- [ ] T008 Validate quickstart.md Scenario 1 (progress survives logout), Scenario 2 (guest play), Scenario 3 (re-login restores), and Scenario 4 (restart persistence) manually on the iOS simulator.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundational)**: No dependencies — start immediately
- **Phase 2 (US1)**: Requires Phase 1 complete (needs `writeGuestSnapshot` + `readGuestSnapshot`)
- **Phase 3 (US2)**: Requires Phase 1 complete (needs `readGuestSnapshot`); can run in parallel with Phase 2
- **Phase 4 (US3)**: Requires Phase 1 complete (needs `clearGuestSnapshot`); can run in parallel with Phases 2 and 3
- **Phase 5 (Polish)**: T006 and T007 can run in parallel with Phase 2–4 (same file, same function); T008 requires all phases complete

### Parallel Opportunities

Phases 2, 3, and 4 touch different files and can be implemented simultaneously once Phase 1 is done:

```
Phase 1: T001  (lib/guestSnapshot.ts)
          ↓
Phase 2: T002  (profile.tsx — write on logout)
Phase 3: T003  (supabase.ts — seed hearts cache)   ← parallel with T002
Phase 4: T004  (profile.tsx — guest display)        ← parallel with T002, T003
Phase 5: T005  (AuthContext.tsx — clear on login)   ← parallel with T002, T003, T004
```

Note: T002 and T004 both touch `profile.tsx` — coordinate or do sequentially.

---

## Implementation Strategy

### MVP First (User Story 1 — Phase 1 + 2)

1. Complete **T001** — create `lib/guestSnapshot.ts`
2. Complete **T002** — write snapshot on logout (`profile.tsx`)
3. Complete **T003** — seed hearts cache from snapshot (`supabase.ts`)
4. **STOP and VALIDATE**: quickstart.md Scenario 1 + Scenario 4
5. Lives survive logout → MVP shipped

### Incremental Delivery

1. T001 → T002 + T003 → **US1 done** (lives + coins snapshot)
2. T004 → **US2 done** (guest profile displays snapshot values)
3. T005 → **US3 done** (re-login clears snapshot)
4. T006 + T007 + T008 → **Polish done**

---

## Notes

- All changes are isolated to 4 files + 1 new file. No Supabase schema changes.
- `writeGuestSnapshot` must be fire-and-forget (no `await`) in the logout handler — the user should not wait for disk I/O.
- `MAX_LIVES` is imported from `lib/supabase.ts` in `lib/guestSnapshot.ts` — no magic numbers.
- Guest coin display in profile is read-only during the guest session (no coin earning for guests yet — deferred per research.md).
- Rebuild not required (TypeScript-only changes, Metro hot-reload sufficient).
