/**
 * Efeitos sonoros do sistema, sintetizados na hora: um bipe de menu, o esbarrao
 * na parede, o passo na grama alta. Sao sons curtos demais para virarem arquivo.
 */
import { midiToFrequency, scheduleNote, type VoiceOptions } from './synth.js';

export type SfxName =
  | 'select'
  | 'cancel'
  | 'bump'
  | 'warp'
  | 'grass'
  | 'menu'
  | 'hit'
  | 'super'
  | 'weak'
  | 'faint'
  | 'ball'
  | 'click';

interface SfxStep {
  /** Nota MIDI. */
  note: number;
  /** Atraso em relacao ao inicio do efeito, em segundos. */
  at: number;
  duration: number;
  velocity: number;
  voice: Partial<VoiceOptions>;
}

const BLIP: VoiceOptions = {
  timbre: 'pulse',
  attack: 0.001,
  decay: 0.04,
  sustain: 0.3,
  release: 0.04,
  gain: 0.5,
};

const NOISE: VoiceOptions = {
  timbre: 'noise',
  attack: 0.001,
  decay: 0.06,
  sustain: 0,
  release: 0.04,
  gain: 0.6,
};

/** Cada efeito e uma sequencia curta de notas. */
const SFX: Record<SfxName, SfxStep[]> = {
  select: [{ note: 84, at: 0, duration: 0.05, velocity: 0.5, voice: {} }],
  click: [{ note: 88, at: 0, duration: 0.03, velocity: 0.35, voice: {} }],
  cancel: [{ note: 72, at: 0, duration: 0.07, velocity: 0.45, voice: {} }],
  menu: [
    { note: 79, at: 0, duration: 0.05, velocity: 0.45, voice: {} },
    { note: 84, at: 0.05, duration: 0.07, velocity: 0.45, voice: {} },
  ],
  bump: [{ note: 45, at: 0, duration: 0.09, velocity: 0.5, voice: { timbre: 'square' } }],
  grass: [{ note: 70, at: 0, duration: 0.07, velocity: 0.3, voice: { timbre: 'noise' } }],
  warp: [
    { note: 76, at: 0, duration: 0.05, velocity: 0.4, voice: {} },
    { note: 83, at: 0.06, duration: 0.05, velocity: 0.4, voice: {} },
    { note: 88, at: 0.12, duration: 0.12, velocity: 0.4, voice: {} },
  ],
  hit: [{ note: 55, at: 0, duration: 0.1, velocity: 0.6, voice: { timbre: 'noise' } }],
  super: [
    { note: 60, at: 0, duration: 0.09, velocity: 0.7, voice: { timbre: 'noise' } },
    { note: 48, at: 0.06, duration: 0.16, velocity: 0.7, voice: { timbre: 'square' } },
  ],
  weak: [{ note: 40, at: 0, duration: 0.09, velocity: 0.4, voice: { timbre: 'noise' } }],
  faint: [
    { note: 72, at: 0, duration: 0.1, velocity: 0.5, voice: { timbre: 'square' } },
    { note: 60, at: 0.09, duration: 0.12, velocity: 0.45, voice: { timbre: 'square' } },
    { note: 48, at: 0.2, duration: 0.24, velocity: 0.4, voice: { timbre: 'square' } },
  ],
  ball: [
    { note: 84, at: 0, duration: 0.04, velocity: 0.45, voice: {} },
    { note: 79, at: 0.05, duration: 0.06, velocity: 0.4, voice: {} },
  ],
};

export function playSfx(
  context: AudioContext,
  destination: AudioNode,
  name: SfxName,
): void {
  const steps = SFX[name];
  if (!steps) return;
  const now = context.currentTime + 0.01;

  for (const step of steps) {
    const base = step.voice.timbre === 'noise' ? NOISE : BLIP;
    scheduleNote(
      context,
      destination,
      { ...base, ...step.voice },
      midiToFrequency(step.note),
      now + step.at,
      step.duration,
      step.velocity,
    );
  }
}
