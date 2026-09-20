/**
 * Fachada do audio: musica, efeitos e os gritos dos Pokemon.
 *
 * Navegador nenhum deixa tocar som antes de um gesto do usuario, entao tudo
 * fica em espera ate o primeiro toque -- inclusive a musica pedida antes disso,
 * que comeca sozinha assim que o audio e liberado.
 */
import { MusicPlayer, type MusicSong } from './music.js';
import { playSfx, type SfxName } from './sfx.js';

const BASE = `${import.meta.env.BASE_URL ?? '/'}assets`.replace(/\/{2,}/g, '/');
/**
 * Gritos dos Pokemon. A versao "legacy" e a dos jogos de GBA, que combina com
 * os sprites de Black/White que o jogo usa.
 */
const CRY_CDN = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/legacy';
const CRY_FALLBACK = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest';

export type SongId = string;

interface PendingMusic {
  id: SongId;
  loop: boolean;
}

class AudioEngine {
  private context: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private music: MusicPlayer | null = null;

  private songs = new Map<SongId, Promise<MusicSong | null>>();
  private cries = new Map<number, HTMLAudioElement>();

  private currentSong: SongId | null = null;
  /** Musica que estava tocando antes de um jingle curto entrar na frente. */
  private resumeSong: SongId | null = null;
  private pending: PendingMusic | null = null;

  private musicVolume = 0.55;
  private sfxVolume = 0.7;
  private muted = false;

  /** Liga o audio. Precisa ser chamado dentro de um gesto do usuario. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      this.flushPending();
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const context = new Ctor();
    this.context = context;

    this.musicGain = context.createGain();
    this.sfxGain = context.createGain();
    this.musicGain.connect(context.destination);
    this.sfxGain.connect(context.destination);
    this.applyVolumes();

    this.music = new MusicPlayer(context, this.musicGain);
    void context.resume();
    this.flushPending();
  }

  get enabled(): boolean {
    return this.context !== null && !this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
    if (muted) this.music?.stop(0.1);
    else if (this.currentSong) void this.playMusic(this.currentSong);
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    this.applyVolumes();
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = volume;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const context = this.context;
    if (!context || !this.musicGain || !this.sfxGain) return;
    const now = context.currentTime;
    this.musicGain.gain.setTargetAtTime(this.muted ? 0 : this.musicVolume, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.muted ? 0 : this.sfxVolume, now, 0.05);
  }

  /** Troca a musica de fundo. Repetir a mesma musica nao a reinicia. */
  async playMusic(id: SongId, { loop = true, force = false } = {}): Promise<void> {
    if (!force && this.currentSong === id && this.music?.playing) return;
    this.currentSong = id;

    if (!this.context || !this.music) {
      this.pending = { id, loop };
      return;
    }
    if (this.muted) return;

    const song = await this.loadSong(id);
    // Outra musica pode ter sido pedida enquanto esta carregava.
    if (!song || this.currentSong !== id) return;
    this.music.play(song, { loop });
  }

  /**
   * Toca um trecho curto por cima (capturou, subiu de nivel) e volta sozinho
   * para a musica que estava tocando.
   */
  async playJingle(id: SongId): Promise<void> {
    if (!this.context || !this.music || this.muted) return;
    const song = await this.loadSong(id);
    if (!song) return;

    this.resumeSong = this.currentSong;
    this.currentSong = id;
    const previous = this.resumeSong;
    this.music.play(song, {
      loop: false,
      onDone: () => {
        this.resumeSong = null;
        if (previous) {
          this.currentSong = null;
          void this.playMusic(previous);
        }
      },
    });
  }

  stopMusic(): void {
    this.currentSong = null;
    this.pending = null;
    this.music?.stop();
  }

  sfx(name: SfxName): void {
    if (!this.context || !this.sfxGain || this.muted) return;
    playSfx(this.context, this.sfxGain, name);
  }

  /** Grito do Pokemon, vindo do repositorio de audio do PokeAPI. */
  cry(species: number): void {
    if (this.muted || typeof Audio === 'undefined') return;
    let audio = this.cries.get(species);
    if (!audio) {
      audio = new Audio(`${CRY_CDN}/${species}.ogg`);
      audio.preload = 'auto';
      // Gritos so existem na forma "legacy" ate a geracao 5.
      audio.addEventListener(
        'error',
        () => {
          if (audio && !audio.src.includes('/latest/')) {
            audio.src = `${CRY_FALLBACK}/${species}.ogg`;
          }
        },
        { once: true },
      );
      this.cries.set(species, audio);
    }
    audio.volume = Math.min(1, this.sfxVolume);
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }

  private loadSong(id: SongId): Promise<MusicSong | null> {
    const existing = this.songs.get(id);
    if (existing) return existing;

    const promise = fetch(`${BASE}/music/${id}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<MusicSong>) : null))
      .catch(() => null);
    this.songs.set(id, promise);
    return promise;
  }

  private flushPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.currentSong = null;
      void this.playMusic(pending.id, { loop: pending.loop });
    }
  }
}

export const audio = new AudioEngine();

/** Qual musica combina com cada mapa. */
export function songForMap(map: {
  id: string;
  name: string;
  type: string;
  section: string;
}): SongId {
  const name = map.name;

  if (/PokemonCenter/i.test(name)) return 'mus_poke_center';
  if (/Gym\b/i.test(name)) return 'mus_gym';
  if (/Lab\b/i.test(name)) return 'mus_oak_lab';
  if (/PokemonTower/i.test(name)) return 'mus_poke_tower';
  if (/Cave|Tunnel|MtMoon|Mt_Moon|Cavern/i.test(name)) return 'mus_mt_moon';

  if (map.section === 'MAPSEC_PALLET_TOWN') return 'mus_pallet';
  if (map.section === 'MAPSEC_LAVENDER_TOWN') return 'mus_lavender';
  if (map.section === 'MAPSEC_CELADON_CITY') return 'mus_celadon';
  if (map.section === 'MAPSEC_CINNABAR_ISLAND') return 'mus_cinnabar';
  if (map.section === 'MAPSEC_FUCHSIA_CITY') return 'mus_fuchsia';

  const route = /^MAPSEC_ROUTE_?(\d+)/.exec(map.section);
  if (route) {
    const number = Number(route[1]);
    // As quatro musicas de rota do original se dividem por regiao do mapa.
    if (number <= 2) return 'mus_route1';
    if (number <= 10) return 'mus_route3';
    if (number <= 18) return 'mus_route11';
    return 'mus_route24';
  }

  if (map.type === 'MAP_TYPE_CITY' || map.type === 'MAP_TYPE_TOWN') return 'mus_pewter';
  return 'mus_route1';
}
