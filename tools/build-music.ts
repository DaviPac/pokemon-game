/**
 * Converte as musicas originais do FireRed para um formato que o navegador
 * toca sem plugin nenhum.
 *
 * Os MIDIs estao no decomp (`sound/songs/midi/*.mid`). Aqui eles sao lidos,
 * os eventos viram notas com tempo em segundos, e cada faixa sai como JSON.
 * Quem toca e um sintetizador chiptune em WebAudio, no espirito do GBA --
 * nenhum arquivo de audio precisa ser distribuido.
 *
 * Saida: public/assets/music/<nome>.json e public/assets/data/music.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchSource, mapLimit } from './lib/net.js';

const OUT_MUSIC = join(process.cwd(), 'public', 'assets', 'music');
const OUT_DATA = join(process.cwd(), 'public', 'assets', 'data');

/** As musicas que o jogo realmente usa; converter as 92 so inflaria o pacote. */
const SONGS: { id: string; label: string }[] = [
  { id: 'mus_pallet', label: 'Pallet Town' },
  { id: 'mus_route1', label: 'Rota 1' },
  { id: 'mus_route3', label: 'Rota 3' },
  { id: 'mus_route11', label: 'Rota 11' },
  { id: 'mus_route24', label: 'Rota 24' },
  { id: 'mus_pewter', label: 'Cidades' },
  { id: 'mus_celadon', label: 'Celadon' },
  { id: 'mus_cinnabar', label: 'Cinnabar' },
  { id: 'mus_fuchsia', label: 'Fuchsia' },
  { id: 'mus_lavender', label: 'Lavender' },
  { id: 'mus_poke_center', label: 'Centro Pokemon' },
  { id: 'mus_oak_lab', label: 'Laboratorio' },
  { id: 'mus_gym', label: 'Ginasio' },
  { id: 'mus_mt_moon', label: 'Cavernas' },
  { id: 'mus_poke_tower', label: 'Torre Pokemon' },
  { id: 'mus_vs_wild', label: 'Batalha selvagem' },
  { id: 'mus_vs_trainer', label: 'Batalha de treinador' },
  { id: 'mus_vs_gym_leader', label: 'Lider de ginasio' },
  { id: 'mus_victory_wild', label: 'Vitoria' },
  { id: 'mus_victory_trainer', label: 'Vitoria (treinador)' },
  { id: 'mus_caught', label: 'Capturou' },
  { id: 'mus_level_up', label: 'Subiu de nivel' },
  { id: 'mus_heal', label: 'Cura' },
  { id: 'mus_obtain_item', label: 'Item obtido' },
  { id: 'mus_obtain_badge', label: 'Insignia' },
  { id: 'mus_oak', label: 'Professor Oak' },
  { id: 'mus_title', label: 'Tela de titulo' },
  { id: 'mus_evolution', label: 'Evolucao' },
];

interface Note {
  /** Inicio em segundos. */
  t: number;
  /** Duracao em segundos. */
  d: number;
  /** Nota MIDI (60 = do central). */
  n: number;
  /** Volume 0..1. */
  v: number;
}

interface Track {
  channel: number;
  program: number;
  notes: Note[];
}

async function main(): Promise<void> {
  await mkdir(OUT_MUSIC, { recursive: true });
  await mkdir(OUT_DATA, { recursive: true });

  const index: Record<string, { file: string; label: string; duration: number; notes: number }> = {};

  const results = await mapLimit(SONGS, 6, async ({ id, label }) => {
    const buffer = await fetchSource('firered', `sound/songs/midi/${id}.mid`);
    if (!buffer) {
      console.log(`[music] sem MIDI: ${id}`);
      return null;
    }
    try {
      const song = parseMidi(buffer);
      return { id, label, song };
    } catch (err) {
      console.log(`[music] falhou ${id}: ${(err as Error).message}`);
      return null;
    }
  });

  for (const result of results) {
    if (!result) continue;
    const { id, label, song } = result;
    const file = `${id}.json`;
    await writeFile(join(OUT_MUSIC, file), JSON.stringify(song));
    const notes = song.tracks.reduce((acc, t) => acc + t.notes.length, 0);
    index[id] = { file, label, duration: song.duration, notes };
  }

  await writeFile(join(OUT_DATA, 'music.json'), JSON.stringify(index));
  const total = Object.values(index).reduce((acc, s) => acc + s.notes, 0);
  console.log(`[music] ${Object.keys(index).length} musicas, ${total} notas`);
}

interface Song {
  duration: number;
  tracks: Track[];
}

/**
 * Leitor de MIDI (Standard MIDI File). Converte delta-ticks em segundos usando
 * o mapa de andamento, porque o sequenciador do jogo pensa em tempo real.
 */
function parseMidi(buffer: Buffer): Song {
  if (buffer.toString('ascii', 0, 4) !== 'MThd') throw new Error('nao e um MIDI');
  const format = buffer.readUInt16BE(8);
  const trackCount = buffer.readUInt16BE(10);
  const division = buffer.readUInt16BE(12);
  if (division & 0x8000) throw new Error('MIDI em SMPTE nao suportado');
  void format;

  // Primeira passada: eventos crus por faixa, em ticks absolutos.
  interface RawEvent {
    tick: number;
    type: 'on' | 'off' | 'program' | 'tempo';
    channel: number;
    a: number;
    b: number;
  }
  const rawTracks: RawEvent[][] = [];
  const tempoChanges: { tick: number; usPerBeat: number }[] = [];

  let offset = 14;
  for (let t = 0; t < trackCount && offset < buffer.length; t++) {
    if (buffer.toString('ascii', offset, offset + 4) !== 'MTrk') break;
    const length = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    let pos = offset + 8;
    let tick = 0;
    let runningStatus = 0;
    const events: RawEvent[] = [];

    while (pos < end) {
      const delta = readVarInt(buffer, pos);
      pos = delta.next;
      tick += delta.value;

      let status = buffer[pos];
      if (status < 0x80) {
        // Running status: repete o comando anterior.
        status = runningStatus;
      } else {
        pos++;
        if (status < 0xf0) runningStatus = status;
      }

      const command = status & 0xf0;
      const channel = status & 0x0f;

      if (status === 0xff) {
        const metaType = buffer[pos++];
        const metaLength = readVarInt(buffer, pos);
        pos = metaLength.next;
        if (metaType === 0x51 && metaLength.value === 3) {
          tempoChanges.push({
            tick,
            usPerBeat: (buffer[pos] << 16) | (buffer[pos + 1] << 8) | buffer[pos + 2],
          });
        }
        pos += metaLength.value;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const sysexLength = readVarInt(buffer, pos);
        pos = sysexLength.next + sysexLength.value;
        continue;
      }

      switch (command) {
        case 0x80:
          events.push({ tick, type: 'off', channel, a: buffer[pos], b: buffer[pos + 1] });
          pos += 2;
          break;
        case 0x90: {
          const note = buffer[pos];
          const velocity = buffer[pos + 1];
          // Nota com volume zero e um "note off" disfarcado.
          events.push({
            tick,
            type: velocity === 0 ? 'off' : 'on',
            channel,
            a: note,
            b: velocity,
          });
          pos += 2;
          break;
        }
        case 0xc0:
          events.push({ tick, type: 'program', channel, a: buffer[pos], b: 0 });
          pos += 1;
          break;
        case 0xd0:
          pos += 1;
          break;
        default:
          pos += 2;
          break;
      }
    }

    rawTracks.push(events);
    offset = end;
  }

  if (tempoChanges.length === 0) tempoChanges.push({ tick: 0, usPerBeat: 500000 });
  tempoChanges.sort((a, b) => a.tick - b.tick);

  /** Converte ticks em segundos respeitando as mudancas de andamento. */
  const toSeconds = (targetTick: number): number => {
    let seconds = 0;
    let lastTick = 0;
    let usPerBeat = tempoChanges[0].usPerBeat;
    for (const change of tempoChanges) {
      if (change.tick >= targetTick) break;
      seconds += ((change.tick - lastTick) / division) * (usPerBeat / 1_000_000);
      lastTick = change.tick;
      usPerBeat = change.usPerBeat;
    }
    seconds += ((targetTick - lastTick) / division) * (usPerBeat / 1_000_000);
    return seconds;
  };

  // Segunda passada: casa cada note-on com o seu note-off.
  const tracks: Track[] = [];
  let duration = 0;

  for (const events of rawTracks) {
    const byChannel = new Map<number, Track>();
    const pending = new Map<string, { tick: number; velocity: number }>();

    for (const event of events) {
      if (event.type === 'program') {
        const track = ensureTrack(byChannel, event.channel);
        track.program = event.a;
        continue;
      }
      if (event.type !== 'on' && event.type !== 'off') continue;

      const key = `${event.channel}:${event.a}`;
      if (event.type === 'on') {
        pending.set(key, { tick: event.tick, velocity: event.b });
        continue;
      }

      const start = pending.get(key);
      if (!start) continue;
      pending.delete(key);

      const track = ensureTrack(byChannel, event.channel);
      const t = toSeconds(start.tick);
      const d = Math.max(0.03, toSeconds(event.tick) - t);
      track.notes.push({
        t: round(t),
        d: round(d),
        n: event.a,
        v: round(start.velocity / 127),
      });
      duration = Math.max(duration, t + d);
    }

    for (const track of byChannel.values()) {
      if (track.notes.length > 0) {
        track.notes.sort((a, b) => a.t - b.t);
        tracks.push(track);
      }
    }
  }

  return { duration: round(duration), tracks };
}

function ensureTrack(map: Map<number, Track>, channel: number): Track {
  const existing = map.get(channel);
  if (existing) return existing;
  const track: Track = { channel, program: 0, notes: [] };
  map.set(channel, track);
  return track;
}

/** Inteiro de tamanho variavel: o jeito do MIDI de guardar os delta-times. */
function readVarInt(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let pos = start;
  for (let i = 0; i < 4; i++) {
    const byte = buffer[pos++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return { value, next: pos };
}

/** Tres casas bastam e cortam o JSON quase pela metade. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
