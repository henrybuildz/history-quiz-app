# Contract: `useAchievements()` Hook

**File**: `hooks/useAchievements.ts`
**Consumer**: Any React component that needs to trigger achievement notifications
**Type**: React hook (must follow Rules of Hooks — call only at top level)

---

## Signature

```ts
function useAchievements(): {
  enqueueToasts: (ids: string[]) => void;
  unlockedIds: Set<string>;
}
```

---

## Returned Values

### `enqueueToasts(ids: string[]): void`

Queues one or more achievement notifications for display.

| Behaviour | Detail |
|-----------|--------|
| Deduplication | IDs already in `unlockedIds` are silently ignored. |
| Unknown IDs | IDs not in `ACHIEVEMENT_MAP` are silently skipped. |
| Ordering | Cards appear in the order the IDs were passed. |
| Thread safety | Safe to call from async callbacks (e.g. after `await saveQuizResult(...)`). |
| Side effects | Appends to `toastQueue`; updates `unlockedIds`. |

**Example**:
```ts
const { enqueueToasts } = useAchievements();
// Called after quiz result returns
enqueueToasts(result.newlyUnlocked);
```

### `unlockedIds: Set<string>`

Read-only snapshot of all achievement IDs that have been unlocked this session (includes those loaded from DB on profile mount). Re-renders the consumer whenever the set changes.

**Example use case**: Conditionally rendering a lock icon on achievements the player hasn't earned yet.

---

## What the hook does NOT expose

| Excluded | Reason |
|----------|--------|
| `toastQueue` | Internal to `AchievementToast.tsx`; no consumer should iterate the queue |
| `dismissToastByKey` | Internal dismiss mechanism; not a public API |
| `clearAll` | Called only on sign-out by the auth flow, not from arbitrary components |
| `setUnlocked` | Called only by the profile loader, not from arbitrary components |

---

## Stability guarantees

- `enqueueToasts` is a stable function reference (Zustand action). It will not cause re-renders when used as a `useCallback` dependency.
- `unlockedIds` is a new `Set` reference whenever any ID is added. Components that only call `enqueueToasts` and do not read `unlockedIds` will not re-render when the set grows.

---

## Implementation note

The hook is a thin selector wrapper over `useAchievementStore`. It selects both fields in a single call to avoid double subscription:

```ts
export function useAchievements() {
  return useAchievementStore(s => ({
    enqueueToasts: s.enqueueToasts,
    unlockedIds:   s.unlockedIds,
  }));
}
```
