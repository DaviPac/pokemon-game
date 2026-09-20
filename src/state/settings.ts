import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MovementMode } from '../game/input/InputBus.js';

export interface Settings {
  movementMode: MovementMode;
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
      zoom: 0,
      vibration: true,
      fastAnimations: false,
      showGrid: false,
      battleAnimations: true,
      set: (key, value) => set({ [key]: value } as Partial<SettingsStore>),
    }),
    { name: 'pokedeluge:settings' },
  ),
);

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
