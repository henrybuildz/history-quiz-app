import { create } from 'zustand';

// Cross-screen signal: quiz screen bumps profileVersion after each DB save;
// profile screen watches it in a useEffect to re-fetch even while unfocused.
// Kept separate from quizStore so domain state and coordination signals stay decoupled.
interface ProfileSignalStore {
  profileVersion: number;
  bumpProfileVersion: () => void;
}

// Named with the `use` prefix for hook usage inside components.
// Also safe to call as profileSignalStore.getState() in async callbacks —
// Zustand stores expose .getState() as a static singleton method.
export const profileSignalStore = create<ProfileSignalStore>((set) => ({
  profileVersion: 0,
  bumpProfileVersion: () => set((s) => ({ profileVersion: s.profileVersion + 1 })),
}));

// Re-export as a hook alias for component usage (useProfileSignal(selector)).
export const useProfileSignal = profileSignalStore;
