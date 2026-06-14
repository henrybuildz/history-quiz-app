# Quickstart: Logout Preserve Progress

Validation guide for testing the feature end-to-end after implementation.

## Prerequisites

- Development build running on simulator or device (not Expo Go)
- A registered account (email/password) with some play history (coins > 0, lives < 12)
- Metro bundler running

## Scenario 1 — Progress survives logout (P1)

### Setup
1. Sign in to the account
2. Note the current coin count and life count shown on the Profile tab

### Steps
3. Tap the Settings / gear icon on the Profile tab
4. Tap **Log Out** → confirm

### Expected
- The app navigates back to the onboarding/login screen
- When you go back into the app as a guest: the coin count and life count shown in any guest-accessible profile view match what you noted in step 2
- No loading error, no "0 coins" reset

---

## Scenario 2 — Guest play continues (P2)

### Setup
1. Log out (as per Scenario 1)

### Steps
2. Start a quiz as a guest
3. Complete the quiz (answer all questions)
4. Return to the home/profile view

### Expected
- Quiz starts without error (hearts are available — not reset to 12)
- Wrong answers deduct hearts correctly (same mechanic as when logged in)
- App does not crash or freeze at any point
- Hearts after the quiz reflect actual losses

---

## Scenario 3 — Re-login restores account (P3)

### Setup
1. Log out (as per Scenario 1)
2. Note the coin count displayed in guest mode

### Steps
3. Sign back into the same account

### Expected
- The coin count shown is the **account's** value (same as before logout), not any guest value
- If any lives were lost as a guest, those losses are gone (account lives are shown)
- No "guest" values leak through into the account view

---

## Scenario 4 — Snapshot persists across app restarts

### Setup
1. Log out (as per Scenario 1)

### Steps
2. Force-quit the app
3. Reopen the app (as guest — do not log in)

### Expected
- The coin count and life count are the same as immediately after logout in Scenario 1
- Guest hearts file (`guest-snapshot.json`) is not reset to 12 on restart

---

## Edge case: no storage space

If writing `guest-snapshot.json` fails (e.g. device full), the app must not crash. Logout succeeds; guest starts with `MAX_LIVES` and `0 coins` (degraded but not broken). Validate by mocking a write failure in `writeGuestSnapshot()` during development.

---

## Edge case: logout during quiz

1. Be mid-quiz as a signed-in player
2. Navigate back to Profile tab (quiz resets — current behavior)
3. Log out

Expected: snapshot is written with the profile values at logout time (not mid-quiz state).

---

## Cleanup after testing

- Log back in to restore normal account state
- If testing repeatedly, clear `guest-snapshot.json` via simulator's file browser or by reinstalling the app to start fresh
