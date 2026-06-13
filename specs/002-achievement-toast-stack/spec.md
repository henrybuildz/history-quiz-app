# Feature Specification: Achievement Notification Stack

**Feature Branch**: `002-achievement-toast-stack`

**Created**: 2026-06-12

**Status**: Draft

**Input**: User description: "Build a reusable Achievement Notification stacking system. Requirements: Fixed positioning in the top-right corner, smooth slide-in/out animations, automatic 4-second dismiss timers per card, absolute isolation from the underlying layout to prevent layout shifts. Multiple achievements must stack vertically and reposition dynamically when a card is dismissed."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Single Achievement Notification (Priority: P1)

A player completes a quiz and earns their first achievement. A notification card appears in the top-right corner of the screen, shows the achievement icon, name, and coin reward, and automatically slides away after 4 seconds. The rest of the screen is completely unaffected — buttons, text, and layout remain exactly where they were before and after the card appears.

**Why this priority**: This is the primary user-facing value. Every subsequent story depends on a single card working correctly. It is also the most common case — most sessions unlock at most one achievement.

**Independent Test**: Trigger one achievement unlock after a quiz. Verify the card appears in the top-right, shows the correct content, disappears after 4 seconds, and no other element on screen moves during the entire lifecycle.

**Acceptance Scenarios**:

1. **Given** a player has just completed a quiz that unlocks one achievement, **When** the results screen is shown, **Then** a notification card slides in from the right edge into the top-right corner within 300ms of the results being available.
2. **Given** a notification card is visible, **When** 4 seconds have elapsed, **Then** the card slides back out to the right edge and disappears completely.
3. **Given** a notification card appears or disappears, **When** observing the rest of the screen, **Then** no other element changes position or size.

---

### User Story 2 — Stacked Multiple Notifications (Priority: P2)

A player earns several achievements in the same session. Each achievement card appears individually in the top-right corner, stacking below the previous one. Each card has its own independent 4-second timer. When the topmost card dismisses, the cards below it smoothly slide upward to fill the gap.

**Why this priority**: Multiple unlocks per session are uncommon but expected (e.g., a new player completes their first quiz and earns `quiz_1`, `streak_5`, and `perfect_1` simultaneously). Without stacking, only the last card would be visible and earlier notifications would be lost.

**Independent Test**: Trigger 3 simultaneous achievement unlocks. Verify all 3 cards appear stacked in the top-right corner, each with their own timer, and that dismissing the first card causes the remaining two to reposition smoothly upward.

**Acceptance Scenarios**:

1. **Given** 3 achievements are unlocked simultaneously, **When** the notification system receives all 3, **Then** all 3 cards appear stacked vertically in the top-right corner, each fully visible and not overlapping.
2. **Given** 3 cards are stacked and the topmost card reaches its 4-second timeout, **When** the top card dismisses, **Then** the two remaining cards slide upward to close the gap within 250ms.
3. **Given** multiple cards are visible with independent timers, **When** the second card's timer expires while the first is still visible, **Then** only the second card dismisses and the others are unaffected.

---

### User Story 3 — Manual Early Dismiss (Priority: P3)

A player can tap a notification card to dismiss it before its 4-second timer expires. This is particularly useful when a card is covering a UI element the player wants to interact with.

**Why this priority**: Nice-to-have quality-of-life improvement. The auto-dismiss timer handles the common case; manual dismiss is a convenience for players who want to clear the overlay faster.

**Independent Test**: Show a notification card, tap it before 4 seconds, and verify it dismisses immediately with the same slide-out animation. Verify the timer is cancelled and does not trigger a second dismiss.

**Acceptance Scenarios**:

1. **Given** a notification card is visible, **When** the player taps the card, **Then** the card slides out immediately and its auto-dismiss timer is cancelled.
2. **Given** a card was manually dismissed and other cards were stacked below it, **When** the card dismisses, **Then** the remaining cards reposition upward just as they would on auto-dismiss.

---

### Edge Cases

- What happens when more than 5 achievements are queued at once? Cards beyond the visible limit queue and appear as earlier cards dismiss.
- What if the player navigates to a different screen while cards are visible? Cards continue to display and dismiss on their own timers; they do not reset on navigation.
- What if the same achievement ID is queued twice in rapid succession? The second occurrence is silently dropped — each achievement ID appears at most once per session.
- What if a card's dismiss animation is interrupted by a new card arriving? The incoming card joins the stack; the outgoing card's animation completes normally.
- What if the screen is very short and the stacked cards would overflow the bottom of the visible area? Cards beyond the visible area are not rendered until earlier cards dismiss and create space.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display achievement notification cards anchored to the top-right corner of the screen, in front of all other content.
- **FR-002**: Each notification card MUST display the achievement's icon, name, and coin reward amount.
- **FR-003**: Each notification card MUST automatically dismiss after exactly 4 seconds from the moment it becomes fully visible.
- **FR-004**: Notification cards MUST animate in by sliding from beyond the right screen edge to their stacked position.
- **FR-005**: Notification cards MUST animate out by sliding back beyond the right screen edge.
- **FR-006**: Multiple notification cards MUST stack vertically in the top-right corner with consistent spacing between them.
- **FR-007**: When a card dismisses (by timer or tap), the remaining cards MUST animate smoothly to their new positions within 250ms.
- **FR-008**: The notification overlay MUST be absolutely isolated from the document layout — no screen element may shift position when cards appear or disappear.
- **FR-009**: The system MUST accept a list of achievement IDs and resolve each one's display data (icon, name, coin reward) from the existing achievement catalog.
- **FR-010**: Players MUST be able to tap a card to dismiss it before its auto-dismiss timer expires.
- **FR-011**: Duplicate achievement IDs in the same session MUST be silently ignored.
- **FR-012**: The system MUST display at most 5 cards simultaneously; additional cards in the queue MUST wait until a visible slot becomes available.

### Key Entities

- **Achievement Notification Card**: A single dismissible card in the overlay. Attributes: achievement ID, display name, icon character, coin reward amount, entry timestamp, dismiss timer state.
- **Notification Queue**: The ordered sequence of achievement IDs awaiting display. Items are consumed in order; no item appears more than once per session.
- **Notification Stack**: The set of cards currently visible on screen (max 5). Manages vertical positions and coordinates entry/exit animations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A notification card is visible to the player within 300ms of the achievement unlock event being received.
- **SC-002**: No element outside the notification overlay changes position or size during any part of a card's lifecycle (entry, visible, exit).
- **SC-003**: Up to 5 simultaneous notification cards display correctly — fully visible, non-overlapping, within the top-right safe area.
- **SC-004**: Reposition animation when a card dismisses completes in 250ms or less.
- **SC-005**: Manual tap-dismiss registers within one interaction and does not leave any visible remnant of the card.
- **SC-006**: Screen reader users receive the achievement name and coin reward as an accessible announcement when a card appears, without needing to interact with it.
- **SC-007**: The system correctly queues and displays all achievements from a batch of 10 simultaneous unlocks, with no cards lost or duplicated.

## Assumptions

- The existing achievement catalog (27 defined achievements with icon, name, and coin reward) is the sole source of display data; no new data fields are needed.
- The quiz result flow already returns a list of newly unlocked achievement IDs (`newlyUnlocked: string[]`); the notification system consumes this list directly.
- Coin reward displayed on the card is for informational purposes only — the actual coin credit has already been applied server-side before the notification fires.
- The maximum number of simultaneously visible cards is 5; this covers all known session scenarios (a new player's first quiz can unlock at most 4–5 achievements at once).
- Notification cards are display-only — no navigation or secondary action is triggered by tapping beyond dismiss.
- The feature targets the in-app post-quiz flow only; push notification or lock-screen display is out of scope.
- Reduced-motion accessibility preference should result in instant appear/disappear instead of slide animations, with the 4-second timer unchanged.
