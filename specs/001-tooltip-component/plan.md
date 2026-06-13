# Implementation Plan: Tooltip Component

**Branch**: `001-tooltip-component` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-tooltip-component/spec.md`

## Summary

Build a reusable `Tooltip` component that wraps any React Native child element and displays a contextual floating label on press/long-press, without interfering with the child's existing press handlers. Because the project targets **React Native via Expo** (not a web browser), CSS hover and viewport-based positioning APIs are unavailable. All styling uses `react-native`'s `StyleSheet.create()`, animations use `react-native-reanimated` (already installed), and positioning is achieved through `onLayout` + `measure` rather than `getBoundingClientRect`.

## Technical Context

**Language/Version**: TypeScript 5 (strict mode inferred from project)

**Primary Dependencies**: React Native, Expo SDK 56, `react-native-reanimated` (already in project), `react-native-safe-area-context` (already in project)

**Storage**: N/A

**Testing**: No test runner configured in project; validation via manual Expo Go / simulator testing

**Target Platform**: iOS and Android (React Native); no browser/web tooltip hover semantics available

**Project Type**: Mobile app (Expo Router file-based navigation)

**Performance Goals**: Tooltip show/dismiss animation under 200ms; no JS-thread jank

**Constraints**: No new runtime dependencies; styles must use `StyleSheet.create()` (no CSS, no styled-components); no external tooltip/positioning libraries

**Scale/Scope**: Single shared component, consumed by any screen in the app

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No formal constitution file is present in this project (the constitution template exists but contains only placeholder content). Applying general code quality gates:

| Gate | Status | Notes |
|------|--------|-------|
| No new runtime dependencies | PASS | `react-native-reanimated` already installed |
| Styles via `StyleSheet.create()` | PASS | Required by project convention |
| Component in `components/` flat directory | PASS | Matches existing `AchievementToast.tsx`, `AnimatedSlot.tsx` pattern |
| No CSS files | PASS | Project has zero CSS files; RN uses inline StyleSheet |
| TypeScript with proper types | PASS | All existing files are `.tsx`/`.ts` |

## Project Structure

### Documentation (this feature)

```text
specs/001-tooltip-component/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
components/
├── AchievementToast.tsx   # existing — flat, PascalCase, styles co-located
├── AnimatedSlot.tsx       # existing — flat, PascalCase, styles co-located
└── Tooltip.tsx            # NEW — follows same flat/co-located pattern

constants/
└── theme.ts               # Colors, Fonts, Spacing, Radius — Tooltip imports from here
```

**Structure Decision**: Flat `components/` directory. Single file `components/Tooltip.tsx` containing the component, its TypeScript types, and its `StyleSheet.create()` styles. No separate CSS file — the project has none and React Native does not use CSS files.

## Complexity Tracking

No Constitution violations requiring justification.
