import { useSyncExternalStore } from "react";

/* One shared player, so starting a sound in the grid stops whichever one was playing. */
type SoundState = { url: string | null; playing: boolean };
let sound: SoundState = { url: null, playing: false };
let player: HTMLAudioElement | null = null;
const soundListeners = new Set<() => void>();

function setSound(next: SoundState) {
  sound = next;
  for (const listener of soundListeners) listener();
}

function sharedPlayer() {
  if (!player) {
    const audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("playing", () => setSound({ url: sound.url, playing: true }));
    audio.addEventListener("pause", () => setSound({ url: sound.url, playing: false }));
    audio.addEventListener("ended", () => setSound({ url: sound.url, playing: false }));
    audio.addEventListener("error", () => setSound({ url: sound.url, playing: false }));
    player = audio;
  }
  return player;
}

export function toggleSound(url: string) {
  const audio = sharedPlayer();
  if (sound.url === url && !audio.paused) {
    audio.pause();
    return;
  }
  if (sound.url !== url) {
    audio.src = url;
    setSound({ url, playing: false });
  }
  audio.play().catch(() => setSound({ url, playing: false }));
}

export function stopSound(url: string) {
  if (sound.url === url) player?.pause();
}

/** Pauses the grid's sound, e.g. when a full player starts in a file tab. */
export function pauseGridSound() {
  player?.pause();
}

function subscribeSound(listener: () => void) {
  soundListeners.add(listener);
  return () => {
    soundListeners.delete(listener);
  };
}

export function useSoundPlaying(url: string) {
  return useSyncExternalStore(
    subscribeSound,
    () => sound.url === url && sound.playing,
    () => false,
  );
}
