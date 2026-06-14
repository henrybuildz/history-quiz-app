# Data Model: Logout Preserve Progress

## New: GuestSnapshot (on-device file)

Stored at `{documentDirectory}/guest-snapshot.json`. Written on logout, read at app startup, cleared on re-login.

```
GuestSnapshot {
  lives: number           // lives count at logout (0–MAX_LIVES)
  coins: number           // coin balance at logout (≥ 0)
  lastLifeLostAt: string | null  // ISO-8601 timestamp of last life loss, or null
  version: 1              // schema version for future migration
}
```

**Validation on read**:
- `lives`: clamp to `[0, MAX_LIVES]`, default `MAX_LIVES` if missing/invalid
- `coins`: clamp to `[0, ∞)`, default `0` if missing/invalid
- `lastLifeLostAt`: must be parseable as Date with valid `getTime()`; null otherwise
- `version`: must equal `1`; if not, treat file as corrupt and discard

**Write trigger**: user taps Log Out (before `signOut()` is called)

**Read trigger**: `initGuestHearts()` at app startup (already called in `_layout.tsx`)

**Clear trigger**: `onAuthStateChange` fires with a non-anonymous, non-null user session

---

## Modified: GuestHeartsData (existing, in `lib/supabase.ts`)

No schema change. `initGuestHearts()` now seeds `_guestHeartsCache` from `GuestSnapshot` if one exists, instead of always defaulting to `MAX_LIVES`.

```
GuestHeartsData {       // unchanged
  lives: number
  last_life_lost_at: string | null
}
```

---

## State flow

```
Signed-in session
  └─ profile.lives, profile.coins  (Supabase profiles table)

[User taps Log Out]
  └─ writeGuestSnapshot({ lives, coins, lastLifeLostAt: null })
  └─ supabase.auth.signOut()

Guest session
  └─ lives: from _guestHeartsCache (seeded from snapshot at app start)
  └─ coins: from GuestSnapshot.coins (read-only during guest play)
  └─ profile display: reads snapshot values directly

[User logs back in]
  └─ onAuthStateChange fires with user session
  └─ clearGuestSnapshot()
  └─ profile re-fetches from Supabase (existing behavior)
```

---

## Files affected

| File | Change |
|------|--------|
| `lib/guestSnapshot.ts` | New — read/write/clear snapshot |
| `lib/supabase.ts` | `initGuestHearts()` reads snapshot to seed cache |
| `context/AuthContext.tsx` | `onAuthStateChange` calls `clearGuestSnapshot()` on real-user login |
| `app/(tabs)/profile.tsx` | `signOut` handler calls `writeGuestSnapshot()`; guest display reads snapshot coins/lives |
