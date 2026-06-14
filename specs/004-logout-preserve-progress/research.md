# Research: Logout Preserve Progress

## How current state is managed

### Signed-in users
- **Coins + lives**: fetched from Supabase `profiles` table via `getProfile()` in `lib/supabase.ts`
- **Lives in-session**: managed via Supabase RPCs `regen_lives` / `deduct_life`
- **Quiz save**: `saveQuizResult()` → `save_quiz_session` RPC (writes coins + score atomically)
- **No local copy**: all state lives exclusively in Supabase while signed in

### Guest users (never signed in / anonymous)
- **Lives**: managed via in-memory cache `_guestHeartsCache` in `lib/supabase.ts`, backed by `guest-hearts.json` on device. Default on first launch: `MAX_LIVES` (12).
- **Coins**: not tracked at all. `persistResult()` bails on `!user`, so guests earn no coins today.
- **Profile display**: shows `profile?.coins ?? 0` / `profile?.lives ?? 0` — both 0 for guests because `getProfile()` returns null.

### What happens on logout today
1. `signOut()` → `supabase.auth.signOut()` → SecureStore session cleared
2. `NavigationGuard` detects `!session` → routes to `/(auth)/onboarding`
3. Profile screen `!hasUser` branch clears all state to null / zeros
4. Guest hearts cache is NOT seeded from the account — stays at `MAX_LIVES`
5. **Result**: all account progress (coins, lives) is gone; user appears fresh

## Decisions

### Decision 1: What "progress" to preserve

**Decision**: Coins + lives only. Era unlocks are out of scope because the current codebase has no unlock mechanism — all 12 eras are selectable by everyone. Score history and achievements are Supabase-only and out of scope per the spec.

**Why**: These are the two values immediately visible to the user on logout (profile stats + hearts in quiz). Missing either one is obviously broken.

**Alternatives considered**: Snapshotting full `ProfileRow` (total_score, level, xp, level) — rejected because those are display-only numbers that don't affect gameplay, and syncing them accurately into a read-only guest display would require extra profile-screen plumbing with no user benefit.

---

### Decision 2: Where to store the logout snapshot

**Decision**: New file `lib/guestSnapshot.ts` with its own `guest-snapshot.json` file on device, separate from the existing `guest-hearts.json`.

**Why**: Keeps the snapshot lifecycle (write-on-logout, clear-on-login) cleanly separated from the hearts cache lifecycle (init on app start, mutate on quiz events). Merging them into `lib/supabase.ts` would make an already large file harder to read.

**Alternatives considered**:
- Merge into `lib/supabase.ts` — rejected (too large already)
- AsyncStorage (via Zustand persist) — rejected; `expo-file-system` is already used for guest hearts, consistent to use same mechanism; AsyncStorage adds a dependency for no gain

---

### Decision 3: How lives seeding works at logout

**Decision**: On logout, write `{ lives, lastLifeLostAt }` to the snapshot. `initGuestHearts()` (called at app startup) checks the snapshot and seeds `_guestHeartsCache` from it instead of defaulting to `MAX_LIVES`.

**Why**: The existing in-memory hearts cache (`_guestHeartsCache`) is already the source of truth for guest lives. Seeding it at init with the snapshot value means zero changes to how lives are read/written during gameplay.

**Alternatives considered**: Reading the snapshot directly in `regenLivesLocal()` — rejected because it would require passing the snapshot to every call site, and the init-time seeding approach requires changes in only one place.

---

### Decision 4: Guest coin tracking during guest session

**Decision**: Add `addGuestCoins(amount)` / `getGuestCoins()` / `setGuestCoins(n)` to `lib/guestSnapshot.ts`. The quiz screen calls `addGuestCoins(coinsEarned)` after each completed quiz when `!user`. The profile screen reads `getGuestCoins()` when the user is a guest.

**Why**: Without local coin tracking, quest progress after logout has no continuity (coins never increase). This is the minimal addition needed to satisfy FR-003.

**Coins earned calculation for guests**: The `save_quiz_session` RPC computes the coin award server-side. For guests we approximate with the same formula the quiz screen already knows — `coinsEarned` from the server is not available without a user. Simplest approach: award a flat coin amount per quiz (e.g. 10 coins per completed quiz) locally, matching approximate server behavior.

Actually — revisiting: the `save_quiz_session` RPC formula is opaque (SQL-only). Rather than approximating, guest coin rewards can simply be 0 for now. The feature spec says "progress earned in guest mode accumulates locally" — the critical P1 requirement is that coins/lives DON'T reset to zero on logout. Coin earning in guest mode is P2 and secondary. This can be revisited.

**Revised**: Guest coin earning is deferred. The snapshot carries over the logout-time coin balance; it does not grow during guest play (no quiz result save for guests today). This is consistent with existing behavior for anonymous users.

---

### Decision 5: Re-login clears snapshot

**Decision**: `clearGuestSnapshot()` is called in `AuthContext` inside `onAuthStateChange` when a non-anonymous session with a user arrives. The profile screen then re-fetches from Supabase (existing behavior), which overwrites all displayed values.

**Why**: The snapshot is only meaningful during a guest session. Keeping it after login risks stale values bleeding into the account display if something goes wrong.

**Alternatives considered**: Clearing inside `signInWithEmail` / `signInWithGoogle` callsites — rejected because `onAuthStateChange` covers all login paths (including future ones) unconditionally.

---

### Decision 6: Lives `lastLifeLostAt` in snapshot

**Decision**: Snapshot records the `last_life_lost_at` timestamp from the account's last known life-loss event. This is not available from `getProfile()` (which doesn't return it), so `lastLifeLostAt` in the snapshot defaults to `null` at logout.

**Impact**: If a player had e.g. 8/12 lives at logout, they will continue with 8 lives but the regen clock starts fresh (no prior anchor). This means they may get lives back slightly sooner than they would have if still logged in. Acceptable tradeoff — the alternative is storing the timestamp in the profile row, which requires a schema change.

## Open items (none blocking)

- Guest coin earning could be added later by computing a local coin award in `persistResult()` when `!user` and calling `addGuestCoins(amount)`.
- If era unlock is ever added to the codebase, the snapshot shape can be extended.
