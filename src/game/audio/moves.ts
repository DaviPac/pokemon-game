/**
 * Som dos golpes, sintetizado na hora como o resto do audio do jogo.
 *
 * A forma vem da categoria -- fisico e um baque seco, especial e um disparo
 * que varre a frequencia, status e um brilho curto -- e a cor vem do tipo: o
 * fogo sopra, o eletrico zumbe, o gelo tine, a pedra troveja. Sao os dois
 * dados que o motor ja manda para a animacao, entao o ouvido e o olho contam
 * a mesma coisa.
 */
import type { MoveCategory, PokemonType } from '../data/types.js';
import type { Timbre } from './synth.js';

/** Um gesto sonoro: uma voz que varre de uma frequencia a outra. */
interface Gesture {
  timbre: Timbre;
  from: number;
  to: number;
  duration: number;
  gain: number;
  /** Atraso em relacao ao inicio do golpe. */
  at?: number;
  /** Para o ruido: por onde ele e filtrado, e para onde esse corte anda. */
  filter?: { type: BiquadFilterType; from: number; to: number };
}

/**
 * A cor de cada tipo: a altura em que ele fala, quanto dele e ruido e o timbre
 * da parte afinada.
 */
interface TypeColor {
  /** Frequencia base, em Hz. */
  pitch: number;
  /** 0 = so tom, 1 = so ruido. */
  noise: number;
  timbre: Timbre;
}

const TYPE_COLORS: Record<PokemonType, TypeColor> = {
  Normal: { pitch: 320, noise: 0.5, timbre: 'square' },
  Fire: { pitch: 240, noise: 0.85, timbre: 'saw' },
  Water: { pitch: 420, noise: 0.45, timbre: 'triangle' },
  Electric: { pitch: 760, noise: 0.3, timbre: 'pulse' },
  Grass: { pitch: 380, noise: 0.7, timbre: 'triangle' },
  Ice: { pitch: 900, noise: 0.3, timbre: 'pulse' },
  Fighting: { pitch: 200, noise: 0.7, timbre: 'square' },
  Poison: { pitch: 300, noise: 0.5, timbre: 'saw' },
  Ground: { pitch: 140, noise: 0.8, timbre: 'triangle' },
  Flying: { pitch: 520, noise: 0.75, timbre: 'triangle' },
  Psychic: { pitch: 680, noise: 0.2, timbre: 'pulse' },
  Bug: { pitch: 440, noise: 0.6, timbre: 'saw' },
  Rock: { pitch: 160, noise: 0.85, timbre: 'square' },
  Ghost: { pitch: 360, noise: 0.35, timbre: 'triangle' },
  Dragon: { pitch: 260, noise: 0.5, timbre: 'saw' },
  Dark: { pitch: 220, noise: 0.55, timbre: 'square' },
  Steel: { pitch: 540, noise: 0.6, timbre: 'square' },
  Fairy: { pitch: 820, noise: 0.2, timbre: 'pulse' },
};

const DEFAULT_COLOR: TypeColor = { pitch: 340, noise: 0.5, timbre: 'square' };

export function playMoveSfx(
  context: AudioContext,
  destination: AudioNode,
  type: PokemonType,
  category: MoveCategory,
): void {
  const color = TYPE_COLORS[type] ?? DEFAULT_COLOR;
  const start = context.currentTime + 0.01;
  for (const gesture of gesturesFor(color, category)) {
    play(context, destination, gesture, start);
  }
}

function gesturesFor(color: TypeColor, category: MoveCategory): Gesture[] {
  const { pitch, noise, timbre } = color;

  if (category === 'Physical') {
    // Investida: o ar passa, e entao vem o baque.
    return [
      {
        timbre: 'noise',
        from: pitch * 2,
        to: pitch,
        duration: 0.14,
        gain: 0.3 + noise * 0.3,
        filter: { type: 'bandpass', from: 1400, to: 600 },
      },
      {
        timbre,
        from: pitch * 0.8,
        to: pitch * 0.4,
        duration: 0.16,
        gain: 0.34,
        at: 0.1,
      },
    ];
  }

  if (category === 'Special') {
    // Disparo: uma varredura descendo, com o rastro do tipo por cima.
    return [
      {
        timbre,
        from: pitch * 2.2,
        to: pitch * 0.7,
        duration: 0.26,
        gain: 0.34,
      },
      {
        timbre: 'noise',
        from: pitch,
        to: pitch * 0.5,
        duration: 0.3,
        gain: 0.12 + noise * 0.26,
        at: 0.04,
        filter: { type: 'lowpass', from: 4200, to: 700 },
      },
    ];
  }

  // Status: dois brilhos subindo, sem impacto nenhum.
  return [
    { timbre: 'pulse', from: pitch, to: pitch * 1.5, duration: 0.14, gain: 0.22 },
    { timbre: 'pulse', from: pitch * 1.5, to: pitch * 2.2, duration: 0.2, gain: 0.2, at: 0.12 },
  ];
}

let cachedPulse: PeriodicWave | null = null;
let cachedNoise: AudioBuffer | null = null;

function play(
  context: AudioContext,
  destination: AudioNode,
  gesture: Gesture,
  start: number,
): void {
  const at = start + (gesture.at ?? 0);
  const end = at + gesture.duration;

  const gain = context.createGain();
  gain.connect(destination);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(gesture.gain, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  let source: AudioScheduledSourceNode;
  if (gesture.timbre === 'noise') {
    const noise = context.createBufferSource();
    noise.buffer = (cachedNoise ??= whiteNoise(context));
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = gesture.filter?.type ?? 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(gesture.filter?.from ?? gesture.from, at);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(60, gesture.filter?.to ?? gesture.to),
      end,
    );
    noise.connect(filter);
    filter.connect(gain);
    source = noise;
  } else {
    const oscillator = context.createOscillator();
    if (gesture.timbre === 'pulse') {
      oscillator.setPeriodicWave((cachedPulse ??= pulseWave(context)));
    } else {
      oscillator.type = gesture.timbre === 'saw' ? 'sawtooth' : gesture.timbre;
    }
    oscillator.frequency.setValueAtTime(gesture.from, at);
    // A varredura e o que da movimento ao golpe: um tom parado soa a menu.
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, gesture.to), end);
    oscillator.connect(gain);
    source = oscillator;
  }

  source.start(at);
  source.stop(end + 0.03);
  source.onended = () => gain.disconnect();
}

function whiteNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.5), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Mesma onda de pulso do resto do jogo: o timbre fino do Game Boy. */
function pulseWave(context: BaseAudioContext): PeriodicWave {
  const harmonics = 24;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * 0.25);
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: false });
}
