# Feature Specification: Logout Preserve Progress

**Feature Branch**: `004-logout-preserve-progress`

**Created**: 2026-06-14

**Status**: Draft

**Input**: User description: "When you log out of your account, the progress should save and the game should remain the same, just not saved. It should not restart the game or your progress completely."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Progress Survives Logout (Priority: P1)

A player who has been playing while signed in — earning coins, completing eras, losing hearts — taps Log Out. After logging out, the game looks and feels exactly the same: same coins, same hearts, same unlocked eras. The only difference is they are now playing as a guest and their future progress will not sync to their account.

**Why this priority**: This is the core feature. Without it, logout is destructive and discourages players from managing their account.

**Independent Test**: Sign in, earn coins and unlock an era, tap Log Out, verify the game screen shows the same coin count, heart count, and era unlock state.

**Acceptance Scenarios**:

1. **Given** a signed-in player with 150 coins, 2 hearts, and 3 eras unlocked, **When** they tap Log Out, **Then** they see the same 150 coins, 2 hearts, and 3 eras unlocked on the home screen immediately after logout.
2. **Given** a signed-in player mid-era (partial progress in the current session), **When** they tap Log Out, **Then** the current session's earned coins and hearts are carried over to guest mode.
3. **Given** a player who has just logged out, **When** they navigate through the app, **Then** no loading error, blank state, or progress-reset screen appears.

---

### User Story 2 - Guest Play Continues After Logout (Priority: P2)

After logging out, the player can keep playing. Progress they earn as a guest (coins, hearts, completed quizzes) accumulates locally and is visible while they remain a guest. This local guest progress does not sync to any account.

**Why this priority**: If the game breaks or freezes after logout, the feature is incomplete even if the initial state carried over correctly.

**Independent Test**: Log out, play a quiz as a guest, verify the coin count increases after the quiz ends.

**Acceptance Scenarios**:

1. **Given** a guest player (post-logout), **When** they complete a quiz, **Then** their earned coins are added to the locally stored total.
2. **Given** a guest player, **When** they lose a heart, **Then** the heart count decreases and the local heart regen timer starts.
3. **Given** a guest player, **When** they close and reopen the app, **Then** their local progress is still intact.

---

### User Story 3 - Re-login Restores Account State (Priority: P3)

A player who logged out and played as a guest decides to sign back in. On re-login, their account state is restored. The guest progress earned after logout is not merged into the account — the account data is authoritative.

**Why this priority**: Prevents data conflicts and sets a clear expectation: guest progress is temporary, account progress is permanent.

**Independent Test**: Log out, earn 50 coins as a guest, log back in, verify the coin count matches the account value (not the inflated guest total).

**Acceptance Scenarios**:

1. **Given** a guest player with locally accumulated coins, **When** they sign back into their account, **Then** the app displays their account coin count, not the guest total.
2. **Given** a player who re-logs in, **When** the app loads their account, **Then** the locally stored guest state is cleared and replaced by account data.

---

### Edge Cases

- What happens if the device has no storage space to persist local state on logout?
- What happens if the player logs out while a quiz is actively in progress (not just between quizzes)?
- What happens if the player logs out and immediately logs back in before any guest actions are taken?
- What if the account data on re-login is older than the local state (e.g., another device had the account)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a signed-in player logs out, all current progress visible in the app (coins, hearts, era unlock state, score history) MUST be preserved locally and remain visible immediately after logout.
- **FR-002**: After logout, the player MUST be able to continue using the game in guest mode without any forced reset or loss of visible state.
- **FR-003**: Progress earned in guest mode after logout MUST accumulate locally and be visible during that guest session.
- **FR-004**: Guest-mode progress MUST NOT sync to any account or remote server.
- **FR-005**: When a player signs back in after playing as a guest, the account's authoritative state MUST replace the local guest state.
- **FR-006**: The local guest state MUST persist across app closes and reopens while the player remains logged out.
- **FR-007**: The logout action MUST NOT trigger a full reset of coins, hearts, or era progress.

### Key Entities

- **Local Progress Snapshot**: The set of player state values (coins, hearts, era unlock state) captured at logout and stored on-device for guest-mode continuation.
- **Account State**: The authoritative player state stored in the account, restored on re-login.
- **Guest Session**: The period between logout and next login, during which progress is local-only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of progress values visible before logout (coins, hearts, era unlocks) are visible and accurate immediately after logout with no manual refresh.
- **SC-002**: A player can complete a full quiz session as a guest after logout with no crashes, freezes, or data errors.
- **SC-003**: Guest progress (earned coins, lost hearts) from at least one completed quiz is accurately reflected in the displayed totals without re-entering the game.
- **SC-004**: On re-login, account state is fully restored within the same time as a normal login, with no residual guest values visible.
- **SC-005**: Local guest progress survives an app close and reopen in 100% of cases when the player has not re-logged in.

## Assumptions

- "Progress" is defined as: coin balance, heart/life count, and era unlock state. Score history and achievements are included if they are already stored locally; remote-only data is out of scope.
- On re-login, the account's data takes precedence unconditionally — there is no merge or conflict resolution UI.
- The guest state snapshot taken at logout is based on the last known synced/local values; in-flight network syncs that hadn't completed are not guaranteed to be included.
- The feature applies to manual logout only — session expiry or forced sign-out is out of scope for this spec.
- Players using anonymous (guest) accounts who never signed in are unaffected; this spec only covers users transitioning from a signed-in state to guest.
