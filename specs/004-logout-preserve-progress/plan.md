# Implementation Plan: Logout Preserve Progress

**Branch**: `004-logout-preserve-progress` | **Date**: 2026-06-14 | **Spec**: [spec.md](spec.md)

## Summary

When a signed-in player logs out, their current coin balance and life count are snapshotted to a local file (`guest-snapshot.json`) before the session is cleared. On subsequent app launches in guest mode, the hearts cache is seeded from this snapshot instead of defaulting to MAX_LIVES, and the profile display reads the snapshot's coin balance. When the player re-logs in, the snapshot is cleared and the account state takes over.

## Technical Context

**Language/Version**: TypeScript (strict), React Native 0.85.3, Expo SDK 56

**Primary Dependencies**: expo-file-system (already used for guest hearts), Zustand (auth store), Supabase JS client

**Storage**: On-device file (`guest-snapshot.json`) via `expo-file-system/legacy` — same pattern as existing `guest-hearts.json`

**Testing**: Manual (no automated test suite currently)

**Target Platform**: iOS 16.4+ (simulator + device)

**Project Type**: Mobile app (Expo / React Native)

**Performance Goals**: Snapshot write must complete before `signOut()` is called; write is a single small JSON file (<200 bytes), so latency is negligible

**Constraints**: No network required; must work offline; must not change any Supabase schema

**Scale/Scope**: Single-file local persistence; no new dependencies

## Constitution Check

No formal constitution defined for this project. No gate violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-logout-preserve-progress/
├── plan.md              ← this file
├── research.md          ← decisions and architecture analysis
├── data-model.md        ← GuestSnapshot shape and state flow
├── quickstart.md        ← manual validation scenarios
└── tasks.md             ← created by /speckit-tasks
```

### Source Code

```text
lib/
├── guestSnapshot.ts     ← NEW: read/write/clear snapshot file
└── supabase.ts          ← MODIFY: seed _guestHeartsCache from snapshot in initGuestHearts()

context/
└── AuthContext.tsx      ← MODIFY: clearGuestSnapshot() on real-user login in onAuthStateChange

app/(tabs)/
└── profile.tsx          ← MODIFY: writeGuestSnapshot() before signOut(); guest coin display
```

**Structure Decision**: All changes are contained to existing files + one new lib file. No new screens, stores, or components.

## Implementation Steps

### Step 1 — `lib/guestSnapshot.ts` (new file)

Create the snapshot module with three functions:

**`writeGuestSnapshot({ lives, coins })`**
- Reads `_heartsPath()` equivalent for snapshot: `{documentDirectory}/guest-snapshot.json`
- Writes `{ version: 1, lives, coins, lastLifeLostAt: null }`
- Fire-and-forget async write (same pattern as `_writeGuestHearts`)
- Must be called synchronously (no await) in the logout handler so it doesn't block the UI

**`readGuestSnapshot(): GuestSnapshotData | null`** (async)
- Reads and parses `guest-snapshot.json`
- Validates all fields; returns null if file missing or corrupt

**`clearGuestSnapshot(): void`**
- Fire-and-forget delete of `guest-snapshot.json`
- Called on re-login; failure is non-fatal

```ts
// Shape
interface GuestSnapshotData {
  version: 1
  lives: number
  coins: number
  lastLifeLostAt: string | null
}
```

---

### Step 2 — Modify `lib/supabase.ts`: seed from snapshot

In `_doInitGuestHearts()`, after the existing file-read block:
- Call `readGuestSnapshot()` (async)
- If it returns a value AND the `guest-hearts.json` file was absent or gave MAX_LIVES, override `_guestHeartsCache` with snapshot lives + lastLifeLostAt

Actually simpler: `initGuestHearts()` should call `readGuestSnapshot()` and if found, call `_writeGuestHearts({ lives: snapshot.lives, last_life_lost_at: snapshot.lastLifeLostAt })` to seed the cache before the existing file read runs. Then the existing logic reads the file it just wrote.

Even simpler: in `_doInitGuestHearts()`, after existing logic, check if the cache is still at `MAX_LIVES` (i.e., no `guest-hearts.json` existed). If so, try reading the snapshot and apply it.

```ts
// In _doInitGuestHearts(), after the existing try/catch:
const snapshot = await readGuestSnapshot()
if (snapshot && _guestHeartsCache.lives === MAX_LIVES) {
  _guestHeartsCache = {
    lives: snapshot.lives,
    last_life_lost_at: snapshot.lastLifeLostAt,
  }
}
```

---

### Step 3 — Modify `context/AuthContext.tsx`: clear on login

In the `onAuthStateChange` callback, when a non-anonymous user session arrives, call `clearGuestSnapshot()`:

```ts
const { data: { subscription } } = supabase.auth.onAuthStateChange(
  (_event, session) => {
    setSession(session)
    // Clear guest snapshot when a real account session is restored
    if (session?.user && !session.user.is_anonymous) {
      clearGuestSnapshot()
    }
  }
)
```

---

### Step 4 — Modify `app/(tabs)/profile.tsx`: write snapshot on logout + guest coin display

**4a. Write snapshot before logout**

In the logout handler (around line 428), before `signOut()`:

```ts
// Capture current profile values for guest continuity
if (profile) {
  writeGuestSnapshot({ lives: profile.lives, coins: profile.coins })
}
await signOut()
```

**4b. Guest coin display**

Currently the profile screen shows `profile?.coins ?? 0`. For logged-out guests, `profile` is null. Add a local state `guestCoins` that reads from the snapshot:

```ts
const [guestCoins, setGuestCoins] = useState(0)

useFocusEffect(useCallback(() => {
  if (hasUser) return
  readGuestSnapshot().then(s => { if (s) setGuestCoins(s.coins) })
}, [hasUser]))
```

Then in the coins display: `hasUser ? (profile?.coins ?? 0) : guestCoins`

Similarly for lives: the quiz screen already uses `regenLivesLocal()` which reads the snapshot-seeded cache. The profile display of lives (`profile?.lives ?? 0`) can also show `guestLives` from the snapshot for the profile tab.

## Complexity Tracking

No constitution violations. No added complexity beyond what the feature requires.
