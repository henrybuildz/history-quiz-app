# Data Model: Tooltip Component

**Feature**: 001-tooltip-component | **Date**: 2026-06-12

---

## Entities

### TooltipProps (component interface)

The public API surface of the `Tooltip` component.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | `string` | Yes | Text displayed in the floating tooltip bubble |
| `children` | `React.ReactElement` | Yes | Single child element to wrap; must be a pressable or any View-compatible element |
| `placement` | `'top' \| 'bottom'` | No | Override default placement (default: `'top'`; auto-flips if insufficient space) |
| `delayMs` | `number` | No | Long-press delay before tooltip appears (default: 500ms) |
| `dismissAfterMs` | `number` | No | Auto-dismiss timeout in ms (default: 2500ms, 0 = manual dismiss only) |

---

### TooltipState (internal)

Internal React state managed within the component.

| Field | Type | Description |
|-------|------|-------------|
| `visible` | `boolean` | Whether the tooltip overlay is currently shown |
| `triggerLayout` | `{ x: number; y: number; width: number; height: number; pageX: number; pageY: number } \| null` | Screen-space position of the trigger element, populated by `ref.measure()` |
| `tooltipLayout` | `{ width: number; height: number } \| null` | Measured dimensions of the tooltip bubble itself, used for clamping |

---

### TooltipPosition (computed, not persisted)

Derived from `triggerLayout`, `tooltipLayout`, and `Dimensions.get('window')`. Not stored; recalculated on each show.

| Field | Type | Description |
|-------|------|-------------|
| `top` | `number` | Absolute Y offset for the tooltip View |
| `left` | `number` | Absolute X offset for the tooltip View, clamped to viewport |
| `actualPlacement` | `'top' \| 'bottom'` | Final placement after overflow check (may differ from `placement` prop) |

---

## State Transitions

```
HIDDEN
  │
  ├─[onLongPress fires after delayMs]──▶ measuring trigger with ref.measure()
  │                                              │
  │                                    ┌─────────▼──────────┐
  │                                    │  compute position  │
  │                                    └─────────┬──────────┘
  │                                              │
  │                                         ANIMATING_IN
  │                                              │
  │                               [withTiming opacity 0→1, ~150ms]
  │                                              │
  │                                           VISIBLE
  │                                              │
  │                      ┌───────────────────────┤
  │                      │                       │
  │              [dismissAfterMs timeout]   [tap outside / onPress elsewhere]
  │                      │                       │
  │                 ANIMATING_OUT            ANIMATING_OUT
  │                      │                       │
  │           [withTiming opacity 1→0, ~120ms]   │
  │                      │                       │
  └──────────────────────▼───────────────────────▼
                       HIDDEN
```

---

## Validation Rules

- `label` must be a non-empty string; empty string renders no tooltip and logs a warning in dev mode
- `children` must be exactly one React element (enforced by TypeScript `React.ReactElement` type, not `React.ReactNode`)
- `delayMs` must be ≥ 0 (default 500); values < 0 are clamped to 0
- `dismissAfterMs` must be ≥ 0 (default 2500); 0 means never auto-dismiss
- `placement` default is `'top'`; the component may override to `'bottom'` if insufficient vertical space above the trigger

---

## No Persistent Storage

The Tooltip component is purely in-memory / UI state. It writes nothing to SQLite, Supabase, AsyncStorage, or Zustand. No store integration required.
