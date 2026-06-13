import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AudioStore {
  musicVolume: number;
  isMusicEnabled: boolean;
  setMusicVolume: (v: number) => void;
  setMusicEnabled: (enabled: boolean) => void;
}

export const useAudioStore = create<AudioStore>()(
  persist(
    (set) => ({
      musicVolume: 0.7,
      isMusicEnabled: true,
      setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
      setMusicEnabled: (enabled) => set({ isMusicEnabled: enabled }),
    }),
    { name: 'audio-settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
