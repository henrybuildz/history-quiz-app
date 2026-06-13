import { useAchievementStore } from '../stores/achievementStore';

export function useAchievements() {
  return useAchievementStore(s => ({
    enqueueToasts: s.enqueueToasts,
    unlockedIds:   s.unlockedIds,
  }));
}
