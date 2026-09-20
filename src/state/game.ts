/**
 * Estado global do jogo: dados carregados, save e as acoes que o alteram.
 * Tudo que mexe no save passa por aqui, e o autosave cuida do resto.
 */
import { create } from 'zustand';
import { RNG } from '../game/core/rng.js';
import {
  loadLearnsets,
  loadMoves,
  loadNatures,
  loadSpecies,
  loadTypeChart,
} from '../game/data/assets.js';
import type { TypeChart } from '../game/data/types.js';
import type { Pokemon, PokemonContext } from '../game/pokemon/pokemon.js';
import { healFully, speciesOf } from '../game/pokemon/pokemon.js';
import { createNewSave, trainerXpForLevel, PARTY_LIMIT, type SaveData } from '../game/save/schema.js';
import { loadSave, writeSave } from '../game/save/storage.js';
import { APP_VERSION } from './updates.js';

interface GameStore {
  ctx: PokemonContext | null;
  chart: TypeChart | null;
  save: SaveData | null;
  loading: boolean;
  rng: RNG;

  boot: () => Promise<void>;
  startNewGame: (playerName: string, starter: Pokemon) => Promise<void>;
  setSave: (save: SaveData) => void;
  update: (mutate: (save: SaveData) => void) => void;
  persist: () => Promise<void>;

  addToParty: (pokemon: Pokemon) => 'party' | 'box';
  registerSeen: (species: number) => void;
  registerCaught: (pokemon: Pokemon) => void;
  addItem: (item: string, amount: number) => void;
  consumeItem: (item: string) => boolean;
  addTrainerXp: (amount: number) => { leveledUp: boolean; level: number };
  healParty: () => void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameStore>((set, get) => ({
  ctx: null,
  chart: null,
  save: null,
  loading: true,
  rng: new RNG(),

  boot: async () => {
    const [species, moves, learnsets, natures, chart, save] = await Promise.all([
      loadSpecies(),
      loadMoves(),
      loadLearnsets(),
      loadNatures(),
      loadTypeChart(),
      loadSave(),
    ]);
    set({ ctx: { species, moves, learnsets, natures }, chart, save, loading: false });
  },

  startNewGame: async (playerName, starter) => {
    const save = createNewSave(playerName);
    // Quem esta comecando agora nao tem "novidades" para ler.
    save.lastSeenVersion = APP_VERSION;
    save.party = [starter];
    save.seen = [starter.species];
    save.caught = [starter.species];
    set({ save });
    await writeSave(save);
  },

  setSave: (save) => {
    set({ save });
    scheduleAutosave(get);
  },

  update: (mutate) => {
    const save = get().save;
    if (!save) return;
    // Uma copia rasa basta: o React so precisa ver a raiz mudar.
    const next = { ...save };
    mutate(next);
    next.lastSeenAt = Date.now();
    set({ save: next });
    scheduleAutosave(get);
  },

  persist: async () => {
    const save = get().save;
    if (save) await writeSave(save);
  },

  addToParty: (pokemon) => {
    let destination: 'party' | 'box' = 'box';
    get().update((save) => {
      if (save.party.length < PARTY_LIMIT) {
        save.party = [...save.party, pokemon];
        destination = 'party';
      } else {
        save.box = [...save.box, pokemon];
      }
    });
    return destination;
  },

  registerSeen: (species) => {
    get().update((save) => {
      if (!save.seen.includes(species)) save.seen = [...save.seen, species];
    });
  },

  registerCaught: (pokemon) => {
    get().update((save) => {
      if (!save.caught.includes(pokemon.species)) save.caught = [...save.caught, pokemon.species];
      if (!save.seen.includes(pokemon.species)) save.seen = [...save.seen, pokemon.species];
      save.stats = {
        ...save.stats,
        catches: save.stats.catches + 1,
        catchStreak: save.stats.catchStreak + 1,
        shiniesFound: save.stats.shiniesFound + (pokemon.shiny ? 1 : 0),
        chainCount:
          save.stats.chainSpecies === pokemon.species ? save.stats.chainCount + 1 : 1,
        chainSpecies: pokemon.species,
      };
    });
  },

  addItem: (item, amount) => {
    get().update((save) => {
      save.bag = { ...save.bag, [item]: (save.bag[item] ?? 0) + amount };
    });
  },

  consumeItem: (item) => {
    const save = get().save;
    if (!save || (save.bag[item] ?? 0) <= 0) return false;
    get().update((s) => {
      s.bag = { ...s.bag, [item]: (s.bag[item] ?? 0) - 1 };
    });
    return true;
  },

  addTrainerXp: (amount) => {
    const save = get().save;
    if (!save) return { leveledUp: false, level: 1 };
    let level = save.trainerLevel;
    let xp = save.trainerXp + amount;
    let leveledUp = false;
    while (xp >= trainerXpForLevel(level)) {
      xp -= trainerXpForLevel(level);
      level++;
      leveledUp = true;
    }
    get().update((s) => {
      s.trainerLevel = level;
      s.trainerXp = xp;
    });
    return { leveledUp, level };
  },

  healParty: () => {
    const ctx = get().ctx;
    if (!ctx) return;
    get().update((save) => {
      save.party = save.party.map((p) => {
        const copy = { ...p, moves: p.moves.map((m) => ({ ...m })) };
        healFully(ctx, copy);
        return copy;
      });
    });
  },
}));

function scheduleAutosave(get: () => GameStore): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  // Agrupa varias mudancas seguidas num unico write.
  autosaveTimer = setTimeout(() => {
    const save = get().save;
    if (save) void writeSave(save);
  }, 700);
}

/** Chance de shiny com a corrente de capturas da especie atual. */
export function shinyChanceFor(save: SaveData | null, species: number): number {
  const base = 1 / 4096;
  if (!save || save.stats.chainSpecies !== species) return base;
  // A corrente multiplica a chance ate um teto de ~1/410.
  const multiplier = Math.min(10, 1 + save.stats.chainCount * 0.25);
  return base * multiplier;
}

/** Nome da especie, util fora dos componentes. */
export function speciesName(ctx: PokemonContext, pokemon: Pokemon): string {
  return speciesOf(ctx, pokemon).n;
}
