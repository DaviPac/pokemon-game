/**
 * Formato do save. Tudo fica no aparelho (IndexedDB); `version` existe para que
 * saves antigos possam ser migrados quando o jogo mudar.
 */
import type { Direction } from '../data/types.js';
import type { Pokemon } from '../pokemon/pokemon.js';

export const SAVE_VERSION = 1;
export const PARTY_LIMIT = 6;

export interface Expedition {
  id: string;
  /** Mapa para onde a equipe foi. */
  mapId: string;
  mapName: string;
  /** uids dos Pokemon enviados. */
  team: string[];
  startedAt: number;
  endsAt: number;
  durationMs: number;
  collected: boolean;
}

export interface Egg {
  id: string;
  species: number;
  /** Passos que ainda faltam. */
  stepsLeft: number;
  totalSteps: number;
  createdAt: number;
}

export interface QuestProgress {
  id: string;
  progress: number;
  goal: number;
  claimed: boolean;
}

export interface SaveData {
  version: number;
  createdAt: number;
  lastSeenAt: number;
  playtimeMs: number;
  /** Versao do jogo na ultima vez que este save foi aberto. */
  lastSeenVersion: string | null;

  playerName: string;
  money: number;
  trainerLevel: number;
  trainerXp: number;

  position: { map: string; x: number; y: number; dir: Direction };
  /** Ultimo Centro Pokemon visitado, para onde o jogador volta ao desmaiar. */
  respawn: { map: string; x: number; y: number };

  party: Pokemon[];
  box: Pokemon[];
  bag: Record<string, number>;

  seen: number[];
  caught: number[];
  /** Mapas em que o jogador ja pisou; libera destinos de expedicao. */
  visited: string[];
  badges: string[];
  flags: Record<string, boolean>;

  expeditions: Expedition[];
  eggs: Egg[];
  quests: Record<string, QuestProgress>;

  stats: {
    steps: number;
    battlesWon: number;
    catches: number;
    shiniesFound: number;
    catchStreak: number;
    /** Corrente da cacada atual: mais capturas seguidas da mesma especie
     *  aumentam a chance de shiny. */
    chainSpecies: number | null;
    chainCount: number;
  };

  dailies: {
    lastLoginDay: string;
    streak: number;
  };
}

export function createNewSave(playerName: string): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeenAt: now,
    playtimeMs: 0,
    lastSeenVersion: null,

    playerName,
    money: 3000,
    trainerLevel: 1,
    trainerXp: 0,

    position: { map: 'MAP_PALLET_TOWN', x: 6, y: 8, dir: 'down' },
    respawn: { map: 'MAP_PALLET_TOWN', x: 6, y: 8 },

    party: [],
    box: [],
    bag: { pokeball: 10, potion: 5 },

    seen: [],
    caught: [],
    visited: ['MAP_PALLET_TOWN'],
    badges: [],
    flags: {},

    expeditions: [],
    eggs: [],
    quests: {},

    stats: {
      steps: 0,
      battlesWon: 0,
      catches: 0,
      shiniesFound: 0,
      catchStreak: 0,
      chainSpecies: null,
      chainCount: 0,
    },

    dailies: { lastLoginDay: '', streak: 0 },
  };
}

/**
 * Migra um save antigo para o formato atual.
 *
 * A regra e sempre somar, nunca descartar: campos novos ganham o valor padrao e
 * tudo que o jogador ja tinha continua intacto. Assim uma atualizacao do app
 * nunca custa progresso.
 */
export function migrate(save: Partial<SaveData>): SaveData {
  const base = createNewSave(save.playerName ?? 'Treinador');
  return {
    ...base,
    ...save,
    // Estruturas aninhadas precisam de mesclagem explicita: um spread raso
    // manteria o objeto antigo inteiro e perderia os campos novos.
    position: { ...base.position, ...save.position },
    respawn: { ...base.respawn, ...save.respawn },
    stats: { ...base.stats, ...save.stats },
    dailies: { ...base.dailies, ...save.dailies },
    bag: { ...save.bag },
    party: save.party ?? base.party,
    box: save.box ?? base.box,
    seen: save.seen ?? base.seen,
    caught: save.caught ?? base.caught,
    visited: save.visited ?? base.visited,
    badges: save.badges ?? base.badges,
    flags: save.flags ?? base.flags,
    expeditions: save.expeditions ?? base.expeditions,
    eggs: save.eggs ?? base.eggs,
    quests: save.quests ?? base.quests,
    createdAt: save.createdAt ?? base.createdAt,
    version: SAVE_VERSION,
  };
}

/** XP de treinador necessaria para o proximo nivel. */
export function trainerXpForLevel(level: number): number {
  return Math.floor(100 * level ** 1.5);
}
