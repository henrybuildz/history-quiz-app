import { create } from 'zustand';
import { ACHIEVEMENT_MAP, type AchievementDef } from '../lib/achievements';

interface ToastItem {
  achievementId: string;
  def: AchievementDef;
  // Monotonically increasing key for React reconciliation of the toast queue.
  // Declared inside the store closure (not module-level) so it survives
  // hot-reload without resetting and producing duplicate keys in development.
  key: number;
}

interface AchievementStore {
  unlockedIds: Set<string>;
  toastQueue: ToastItem[];
  // Replace the full unlocked set — called on profile load with DB truth.
  setUnlocked: (ids: string[]) => void;
  // Append newly unlocked achievements to the toast queue — called after quiz save.
  enqueueToasts: (ids: string[]) => void;
  // Advance past the head of the queue — called by AchievementToast when the
  // slide-out animation completes.
  dismissToast: () => void;
  // Reset all state on sign-out so a newly signed-in user doesn't see a previous
  // user's achievements or any queued toasts from their session.
  clearAll: () => void;
}

export const useAchievementStore = create<AchievementStore>((set, get) => {
  let toastKey = 0;

  return {
    unlockedIds: new Set(),
    toastQueue: [],

    setUnlocked: (ids) => {
      const next = new Set(ids);
      const current = get().unlockedIds;
      // for...of with early exit: same O(n) as [...next].every() without the
      // intermediate array allocation.
      if (next.size === current.size) {
        let equal = true;
        for (const id of next) {
          if (!current.has(id)) { equal = false; break; }
        }
        if (equal) return;
      }
      set({ unlockedIds: next });
    },

    enqueueToasts: (ids) => {
      // Deduplicate the input array. The DB never sends duplicates (ARRAY_AGG
      // over a primary-key column), but callers outside the quiz save path
      // (tests, future features) must not cause the same toast to show twice.
      const seen = new Set<string>();
      const candidates: ToastItem[] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const def = ACHIEVEMENT_MAP.get(id);
        // Unknown IDs are silently skipped outside set() so the updater stays pure.
        if (def) candidates.push({ achievementId: id, def, key: ++toastKey });
      }
      if (!candidates.length) return;

      // Deduplication against unlockedIds runs inside set() against live state
      // so concurrent enqueueToasts calls can't race on a stale snapshot and
      // double-queue the same achievement. Key allocation above may leave gaps
      // (items filtered here) — gaps in a monotonic sequence are harmless.
      set(s => {
        const fresh = candidates.filter(item => !s.unlockedIds.has(item.achievementId));
        if (!fresh.length) return s;
        // Build the new unlocked Set in a single pass, no throwaway array.
        const newUnlocked = new Set(s.unlockedIds);
        for (const item of fresh) newUnlocked.add(item.achievementId);
        return {
          unlockedIds: newUnlocked,
          toastQueue:  [...s.toastQueue, ...fresh],
        };
      });
    },

    // FIX W2: guard against the empty-queue case. [].slice(1) produces a new []
    // reference, which would cause Zustand to notify all subscribers and trigger
    // re-renders even when there is nothing to remove. Returning `s` unchanged
    // keeps the reference stable and skips the subscriber notification entirely.
    dismissToast: () => set(s => {
      if (s.toastQueue.length === 0) return s;
      return { toastQueue: s.toastQueue.slice(1) };
    }),

    clearAll: () => set({ unlockedIds: new Set(), toastQueue: [] }),
  };
});
