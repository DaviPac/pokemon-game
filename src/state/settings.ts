import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { audio } from '../game/audio/index.js';
import type { MovementMode } from '../game/input/InputBus.js';

export interface Settings {
  movementMode: MovementMode;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  /** Zoom do mapa: 0 = automatico pelo tamanho da tela. */
  zoom: number;
  vibration: boolean;
  fastAnimations: boolean;
  showGrid: boolean;
  battleAnimations: boolean;
}

interface SettingsStore extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      movementMode: 'new',
      musicVolume: 0.5,
      sfxVolume: 0.7,
      muted: false,
      zoom: 0,
      vibration: true,
      fastAnimations: false,
      showGrid: false,
      battleAnimations: true,
      set: (key, value) => {
        set({ [key]: value } as Partial<SettingsStore>);
        applyAudioSettings();
      },
    }),
    {
      name: 'pokedeluge:settings',
      // O audio precisa respeitar o que estava salvo assim que o save e lido.
      onRehydrateStorage: () => () => applyAudioSettings(),
    },
  ),
);

/** Repassa volume e mudo para o motor de audio. */
export function applyAudioSettings(): void {
  const { musicVolume, sfxVolume, muted } = useSettings.getState();
  audio.setMusicVolume(musicVolume);
  audio.setSfxVolume(sfxVolume);
  audio.setMuted(muted);
}

/** Vibracao curta nos eventos do jogo, quando o aparelho suporta. */
export function haptic(pattern: number | number[]): void {
  if (!useSettings.getState().vibration) return;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // alguns navegadores bloqueiam sem gesto do usuario
    }
  }
}
