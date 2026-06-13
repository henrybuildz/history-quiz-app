# Feature Specification: Skill Tree UI

**Feature Branch**: `003-skill-tree-ui`

**Created**: 2026-06-13

**Status**: Draft

**Input**: User description: "Define a requirement specification for a dynamic skill tree UI. Requirements: The UI must only render skills unlocked by the player, completely hiding locked skills (or utilizing fixed-size placeholders) such that no layout shifts or reflows occur when skills transition. The filtering must reactively update the DOM whenever the player's unlock state changes at runtime, maintaining strict layout stability."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Unlocked Skills Without Layout Shift (Priority: P1)

A player opens the skill tree screen. Only skills they have already unlocked are visible. Locked skills occupy fixed-size placeholder slots in the grid so the overall layout does not shift or reflow when new skills unlock during the session.

**Why this priority**: Core requirement — layout stability is non-negotiable and underpins every other story. Without this, the UI is unusable as a stable surface.

**Independent Test**: Open the skill tree with a known unlock state. Confirm visible skill cards match exactly the unlocked set. Measure layout dimensions before and after observing a skill transition; confirm zero change in surrounding element positions.

**Acceptance Scenarios**:

1. **Given** a player has 3 of 10 skills unlocked, **When** the skill tree screen renders, **Then** exactly 3 skill cards are visible and 7 placeholder slots of identical dimensions occupy the remaining positions.
2. **Given** the skill tree is displayed, **When** the screen is measured at any point during a session, **Then** no surrounding element shifts position relative to its position at initial render.
3. **Given** a player has zero skills unlocked, **When** the skill tree renders, **Then** all slots show as placeholders and the grid layout is fully stable.

---

### User Story 2 - Real-Time Unlock Reflection (Priority: P2)

When the player earns a new skill during an active session (e.g., after completing a quiz), the skill tree reactively replaces the corresponding placeholder with the skill card without requiring a screen reload or manual refresh.

**Why this priority**: Reactive updates deliver the moment of reward — the transition from placeholder to skill card is the payoff for the player's action.

**Independent Test**: Trigger a skill unlock event while the skill tree screen is mounted. Confirm the placeholder transitions to a skill card within one render cycle, with no visible layout shift and no full-screen reload.

**Acceptance Scenarios**:

1. **Given** the skill tree is visible with a placeholder at position N, **When** the player's unlock state is updated to include skill N, **Then** the placeholder at position N is replaced by the skill card for skill N within one render cycle.
2. **Given** an unlock event occurs, **When** the skill card appears, **Then** no other skill card or placeholder changes position.
3. **Given** multiple skills unlock simultaneously, **When** the state update is applied, **Then** all newly unlocked skill cards appear in the same render cycle with no intermediate layout states visible.

---

### User Story 3 - Consistent Layout Across Unlock States (Priority: P3)

The skill tree grid maintains identical outer dimensions and slot positions regardless of how many skills are unlocked — from zero unlocked to fully unlocked — so a player progressing through the game sees a predictable, stable layout at all times.

**Why this priority**: Layout consistency builds trust and allows players to build spatial memory of where skills live in the grid.

**Independent Test**: Render the skill tree at 0%, 50%, and 100% unlock states. Compare grid dimensions and individual slot bounding boxes across all three states; they must be identical.

**Acceptance Scenarios**:

1. **Given** two players with different unlock counts view the skill tree, **When** their screens are compared, **Then** the grid dimensions and slot positions are identical.
2. **Given** a player unlocks the final skill, **When** the last placeholder is replaced by a skill card, **Then** the grid dimensions do not change.

---

### Edge Cases

- What happens when the player's unlock state loads asynchronously after the skill tree is already visible? Placeholders must occupy all slots until state resolves; no reflow when resolved data arrives.
- What happens if an unknown or deprecated skill ID appears in the unlock state? The slot must remain a placeholder; no error state should cause a layout shift.
- What happens on a device with a very narrow screen where skills would overflow the grid? Fixed-size constraint must still hold; overflow clips rather than reflowing adjacent slots.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The skill tree MUST render a fixed grid of slots equal to the total number of skills in the catalog, regardless of how many are unlocked.
- **FR-002**: Each slot MUST have identical, fixed dimensions whether it contains an unlocked skill card or a placeholder.
- **FR-003**: A slot MUST display a visible skill card only when the corresponding skill is present in the player's unlock state.
- **FR-004**: A slot MUST display a placeholder (visually distinct from a skill card but identical in size) when the corresponding skill is not yet unlocked.
- **FR-005**: The skill tree MUST reactively update the display whenever the player's unlock state changes, replacing the appropriate placeholder with a skill card (or vice versa) without a full re-render of the grid.
- **FR-006**: No layout shift or reflow of any slot or surrounding element MUST occur as a result of a skill transitioning between locked and unlocked states.
- **FR-007**: The skill tree MUST render correctly across all unlock states, from zero skills unlocked to all skills unlocked.
- **FR-008**: The unlock state MUST be the single source of truth for which skills are visible; no secondary filtering, caching, or manual refresh mechanism is required from the player.

### Key Entities

- **Skill**: A discrete ability or achievement in the catalog. Has a fixed identity, display name, icon, and description. Exists in the catalog regardless of unlock state.
- **Skill Slot**: A fixed-size grid cell that renders either a Skill Card or a Placeholder depending on unlock state.
- **Skill Card**: The visible, interactive representation of an unlocked Skill within its Slot.
- **Placeholder**: A non-interactive, fixed-size element occupying a Slot for a locked Skill. Visually communicates "something goes here" without revealing skill details.
- **Unlock State**: The runtime data structure representing the set of Skill IDs currently unlocked by the player. Acts as the reactive source that drives Slot rendering decisions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero layout shifts occur across any skill state transition — measured as a Cumulative Layout Shift (CLS) score of 0.00 for the skill tree screen throughout a session.
- **SC-002**: A newly unlocked skill appears in the skill tree within one render cycle of the unlock event — no perceptible delay between unlock and card appearance.
- **SC-003**: Grid slot positions and dimensions are identical at 0%, 50%, and 100% unlock states — bounding boxes of all slots match to the pixel across all three states.
- **SC-004**: The skill tree renders correctly on first paint without waiting for unlock state — placeholders fill all slots immediately, with no blank or unsized slots at any point.
- **SC-005**: The skill tree handles simultaneous unlock of multiple skills in a single state update with no visible intermediate layout states.

## Assumptions

- The total number of skills in the catalog is fixed and known at build time; the grid size does not change at runtime.
- Skill unlock state is managed in a global reactive store (consistent with the existing Zustand-based achievement store pattern in this project).
- Placeholder slots do not reveal the name, icon, or description of the locked skill — they indicate existence of a slot only.
- The skill tree is a dedicated screen (not an inline widget), so full-screen grid layout is appropriate.
- Skill unlock is one-directional at runtime: skills are unlocked but never re-locked within a session.
- The feature covers display only; the unlock logic (when and how skills are earned) is handled by the existing achievement system and is out of scope.
