/**
 * Sequenciador: toca as musicas convertidas do FireRed, em loop, agendando as
 * notas um pouco a frente do relogio do audio para nao engasgar no celular.
 */
import { midiToFrequency, scheduleNote, timbreForProgram, type VoiceOptions } from './synth.js';

export interface MusicNote {
  t: number;
  d: number;
  n: number;
  v: number;
}

export interface MusicTrack {
  channel: number;
  program: number;
  notes: MusicNote[];
}

export interface MusicSong {
  duration: number;
  tracks: MusicTrack[];
}

/** Quanto tempo a frente as notas sao agendadas. */
const LOOKAHEAD_S = 0.35;
const TICK_MS = 120;
/** Pausa curta antes de repetir, para o loop nao soar grudado. */
const LOOP_GAP_S = 0.25;

export class MusicPlayer {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private song: MusicSong | null = null;
  private voices: VoiceOptions[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Posicao no relogio do audio em que o trecho atual comecou. */
  private loopStartedAt = 0;
  private scheduledUntil = 0;
  private loopLength = 0;
  private looping = true;
  private onDone: (() => void) | null = null;

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;
    this.output = context.createGain();
    this.output.connect(destination);
  }

  get playing(): boolean {
    return this.song !== null;
  }

  play(song: MusicSong, { loop = true, onDone }: { loop?: boolean; onDone?: () => void } = {}): void {
    this.stop();
    if (song.tracks.length === 0) return;

    this.song = song;
    this.voices = song.tracks.map((track) => timbreForProgram(track.program, track.channel));
    this.looping = loop;
    this.onDone = onDone ?? null;
    this.loopLength = song.duration + LOOP_GAP_S;
    this.loopStartedAt = this.context.currentTime + 0.06;
    this.scheduledUntil = 0;

    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setValueAtTime(0, this.context.currentTime);
    this.output.gain.linearRampToValueAtTime(1, this.context.currentTime + 0.25);

    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Para com um pequeno fade, para nao cortar seco. */
  stop(fadeSeconds = 0.18): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.song) return;

    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + fadeSeconds);

    this.song = null;
    // Quem esperava o fim da musica precisa ser avisado mesmo quando ela e
    // interrompida, senao fica esperando para sempre.
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  setVolume(volume: number): void {
    this.output.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
  }

  private tick(): void {
    const song = this.song;
    if (!song) return;

    const horizon = this.context.currentTime + LOOKAHEAD_S;

    // Agenda todas as notas que caem na janela, avancando o loop se preciso.
    while (this.loopStartedAt + this.scheduledUntil < horizon) {
      const windowStart = this.scheduledUntil;
      const windowEnd = Math.min(
        this.loopLength,
        horizon - this.loopStartedAt,
      );
      if (windowEnd <= windowStart) break;

      for (const [index, track] of song.tracks.entries()) {
        const voice = this.voices[index];
        for (const note of track.notes) {
          if (note.t < windowStart || note.t >= windowEnd) continue;
          scheduleNote(
            this.context,
            this.output,
            voice,
            midiToFrequency(note.n),
            this.loopStartedAt + note.t,
            note.d,
            note.v,
          );
        }
      }

      this.scheduledUntil = windowEnd;
      if (this.scheduledUntil >= this.loopLength) {
        if (!this.looping) {
          const finishAt = this.loopStartedAt + song.duration;
          const remaining = Math.max(0, finishAt - this.context.currentTime);
          const done = this.onDone;
          setTimeout(() => {
            this.stop(0.05);
            done?.();
          }, remaining * 1000 + 80);
          return;
        }
        this.loopStartedAt += this.loopLength;
        this.scheduledUntil = 0;
      }
    }
  }
}
