# Data Model: Achievement Notification Stack

**Feature**: 002-achievement-toast-stack | **Date**: 2026-06-12

---

## Entities

### `ToastItem` (existing, unchanged)

Single item in the notification queue. Lives only in Zustand — never persisted.

| Field           | Type            | Source                              | Notes |
|-----------------|-----------------|-------------------------------------|-------|
| `achievementId` | `string`        | Passed by caller (quiz screen)      | Must exist in `ACHIEVEMENT_MAP` |
| `def`           | `AchievementDef`| Resolved from `ACHIEVEMENT_MAP`     | Icon, name, description, rewardCoins |
| `key`           | `number`        | Monotonically increasing store counter | Used for React reconciliation and `dismissToastByKey` |

`ToastItem` is created inside `enqueueToasts()` and destroyed by `dismissToastByKey()`. No external code creates `ToastItem` directly.

---

### `AchievementDef` (existing, `lib/achievements.ts`)

Static display data for one achievement. Read-only — never modified at runtime.

| Field         | Type                 | Notes |
|---------------|----------------------|-------|
| `id`          | `string`             | Primary key (e.g. `quiz_1`, `perfect_5`) |
| `name`        | `string`             | Display title (e.g. "First Chronicle") |
| `description` | `string`             | One-line description shown on card |
| `icon`        | `string`             | Single emoji character |
| `category`    | `AchievementCategory`| `progression \| quiz \| accuracy \| era \| score \| secret` |
| `isSecret`    | `boolean`            | Hidden from catalog until unlocked |
| `rewardCoins` | `number`             | ≥ 0; 0 means no coin reward shown on card |

Source of truth: `lib/achievements.ts` (mirrors the Supabase `achievements` table seed).

---

### `AchievementStore` (modified)

Zustand store state shape. The only change from the existing store is replacing `dismissToast()` with `dismissToastByKey(key)`.

| Field / Action          | Type / Signature                    | Notes |
|-------------------------|-------------------------------------|-------|
| `unlockedIds`           | `Set<string>`                       | All achievements unlocked by this user this session. Guards against duplicate notifications. |
| `toastQueue`            | `ToastItem[]`                       | FIFO queue. Renderer shows `slice(0, 5)`. New items appended to tail. |
| `setUnlocked`           | `(ids: string[]) => void`           | Called on profile load with DB truth. |
| `enqueueToasts`         | `(ids: string[]) => void`           | Called after quiz save. Deduplicates, resolves defs, appends to queue. |
| `dismissToastByKey`     | `(key: number) => void`             | **New** — removes item matching `key` from any queue position. |
| `clearAll`              | `() => void`                        | Reset on sign-out. |

**Removed**: `dismissToast(): void` (was queue-head-only; replaced by `dismissToastByKey`).

---

## State Transitions

```
                       enqueueToasts(ids)
                              │
                              ▼
             ┌────────────────────────────────┐
             │  toastQueue (FIFO, max ∞ depth) │
             └────────────────────────────────┘
                              │
                    slice(0, MAX_VISIBLE=5)
                              │
                              ▼
             ┌────────────────────────────────┐
             │  Visible cards (AchievementCard)│
             │  Each card has own:            │
             │    • translateX (enter/exit)   │
             │    • topAnim (reposition)      │
             │    • 4s auto-dismiss timer     │
             └────────────────────────────────┘
                              │
              tap OR timer expires (whichever first)
                              │
                              ▼
                  Exit animation (220ms)
                              │
                              ▼
                  dismissToastByKey(key)
                              │
                    queue shrinks by 1;
                 remaining cards reposition;
                if queue.length > 5, next
                 item becomes newly visible
```

---

## Invariants

1. Every `key` in `toastQueue` is unique (monotonically increasing integer, never reused).
2. `unlockedIds` is a superset of all `achievementId` values ever passed to `enqueueToasts`. Once an ID enters `unlockedIds` it is never removed (except by `clearAll`).
3. `toastQueue.length` can exceed `MAX_VISIBLE` (5) — items beyond index 4 are queued but not rendered.
4. No `ToastItem` appears in `toastQueue` more than once (enforced by `enqueueToasts` deduplication against `unlockedIds`).
5. `AchievementCard` components are only mounted for `toastQueue[0..4]`. React unmounts the card when its item is removed from the queue.
