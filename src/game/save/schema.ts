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

/** Migra saves de versoes anteriores; hoje so preenche campos novos. */
export function migrate(save: SaveData): SaveData {
  const base = createNewSave(save.playerName ?? 'Treinador');
  return {
    ...base,
    ...save,
    stats: { ...base.stats, ...save.stats },
    dailies: { ...base.dailies, ...save.dailies },
    bag: { ...save.bag },
    version: SAVE_VERSION,
  };
}

/** XP de treinador necessaria para o proximo nivel. */
export function trainerXpForLevel(level: number): number {
  return Math.floor(100 * level ** 1.5);
}
