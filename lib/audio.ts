import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

let playerRef: AudioPlayer | null = null;

export async function initAudio(): Promise<void> {
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer(require('../assets/sounds/bgMusic.mp3'));
    player.loop = true;
    player.volume = 0.7;
    playerRef = player;
  } catch {
    // Non-fatal: app works without background music
  }
}

export async function playMusic(): Promise<void> {
  if (!playerRef) return;
  try {
    playerRef.play();
  } catch {
    // Ignore playback errors
  }
}

export async function pauseMusic(): Promise<void> {
  if (!playerRef) return;
  try {
    playerRef.pause();
  } catch {
    // Ignore pause errors
  }
}

export async function setMusicVolume(volume: number): Promise<void> {
  if (!playerRef) return;
  try {
    playerRef.volume = Math.max(0, Math.min(1, volume));
  } catch {
    // Ignore volume errors
  }
}

export async function unloadAudio(): Promise<void> {
  if (!playerRef) return;
  try {
    playerRef.remove();
    playerRef = null;
  } catch {
    playerRef = null;
  }
}

export function isMusicPlaying(): boolean {
  if (!playerRef) return false;
  return playerRef.playing;
}
