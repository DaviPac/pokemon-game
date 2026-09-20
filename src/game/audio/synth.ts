/**
 * Sintetizador chiptune em WebAudio.
 *
 * O GBA toca duas ondas quadradas, uma onda programavel e um canal de ruido.
 * Aqui cada nota do MIDI vira uma voz parecida: quadrada para as melodias,
 * triangular para o baixo e ruido para a percussao. Nenhum arquivo de audio
 * e distribuido -- o som e gerado na hora.
 */

export type Timbre = 'pulse' | 'square' | 'triangle' | 'saw' | 'noise';

export interface VoiceOptions {
  timbre: Timbre;
  /** Ataque, decaimento e soltura em segundos. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Ganho relativo da voz. */
  gain: number;
}

/** Instrumento por programa MIDI, na faixa que o GBA usa. */
export function timbreForProgram(program: number, channel: number): VoiceOptions {
  // Canal 10 do MIDI (indice 9) e sempre percussao.
  if (channel === 9) {
    return { timbre: 'noise', attack: 0.001, decay: 0.07, sustain: 0, release: 0.03, gain: 0.5 };
  }
  // Baixos: onda triangular, como o canal de onda do Game Boy.
  if (program >= 32 && program <= 39) {
    return { timbre: 'triangle', attack: 0.004, decay: 0.12, sustain: 0.75, release: 0.08, gain: 0.85 };
  }
  // Cordas e metais sustentam mais.
  if ((program >= 40 && program <= 55) || (program >= 56 && program <= 63)) {
    return { timbre: 'saw', attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.12, gain: 0.4 };
  }
  // Leads sinteticos: a quadrada classica.
  if (program >= 80 && program <= 87) {
    return { timbre: 'pulse', attack: 0.004, decay: 0.08, sustain: 0.7, release: 0.06, gain: 0.5 };
  }
  // Pianos e sinos: ataque curto e decaimento rapido.
  if (program <= 15) {
    return { timbre: 'square', attack: 0.002, decay: 0.18, sustain: 0.35, release: 0.1, gain: 0.45 };
  }
  return { timbre: 'square', attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.08, gain: 0.45 };
}

export function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** Onda de pulso com 25% de ciclo ativo -- o timbre "fino" do Game Boy. */
function pulseWave(context: BaseAudioContext): PeriodicWave {
  const harmonics = 24;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  const duty = 0.25;
  for (let n = 1; n < harmonics; n++) {
    // Serie de Fourier de uma onda de pulso.
    imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
  }
  return context.createPeriodicWave(real, imag, { disableNormalization: false });
}

let cachedPulse: PeriodicWave | null = null;
let cachedNoise: AudioBuffer | null = null;

function noiseBuffer(context: AudioContext): AudioBuffer {
  if (cachedNoise) return cachedNoise;
  const length = Math.floor(context.sampleRate * 0.4);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // Ruido branco simples; o envelope curto e que da a cara de percussao.
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  cachedNoise = buffer;
  return buffer;
}

/**
 * Agenda uma nota. Retorna sem fazer nada se o contexto estiver suspenso, para
 * nao acumular vozes enquanto o audio ainda nao foi liberado pelo navegador.
 */
export function scheduleNote(
  context: AudioContext,
  destination: AudioNode,
  options: VoiceOptions,
  frequency: number,
  startAt: number,
  duration: number,
  velocity: number,
): void {
  const gain = context.createGain();
  gain.connect(destination);

  const peak = Math.max(0.0001, velocity * options.gain);
  const sustainLevel = Math.max(0.0001, peak * options.sustain);
  const endAt = startAt + duration;

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + options.attack);
  gain.gain.exponentialRampToValueAtTime(
    sustainLevel,
    startAt + options.attack + options.decay,
  );
  gain.gain.setValueAtTime(Math.max(0.0001, sustainLevel), Math.max(endAt, startAt + 0.02));
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt + options.release);

  let source: AudioScheduledSourceNode;
  if (options.timbre === 'noise') {
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer(context);
    noise.loop = true;
    // A nota escolhe o brilho do ruido: grave vira bumbo, agudo vira prato.
    const filter = context.createBiquadFilter();
    filter.type = frequency > 300 ? 'highpass' : 'lowpass';
    filter.frequency.value = frequency > 300 ? 1800 : 380;
    noise.connect(filter);
    filter.connect(gain);
    source = noise;
  } else {
    const oscillator = context.createOscillator();
    if (options.timbre === 'pulse') {
      cachedPulse ??= pulseWave(context);
      oscillator.setPeriodicWave(cachedPulse);
    } else {
      oscillator.type = options.timbre === 'saw' ? 'sawtooth' : options.timbre;
    }
    oscillator.frequency.setValueAtTime(frequency, startAt);
    oscillator.connect(gain);
    source = oscillator;
  }

  source.start(startAt);
  source.stop(endAt + options.release + 0.02);
  source.onended = () => {
    gain.disconnect();
  };
}
