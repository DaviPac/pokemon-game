/**
 * Expedicoes: o lado "passar tempo" do jogo. Voce manda ate tres Pokemon para
 * uma area ja visitada e, quando voltar ao app, eles trazem EXP, dinheiro,
 * itens e, de vez em quando, um Pokemon da regiao ou um ovo.
 *
 * Tudo e calculado por carimbo de tempo no retorno: nada precisa rodar em
 * segundo plano, e fechar o app nao atrapalha.
 */
import { RNG } from '../core/rng.js';
import { loadMap } from '../data/assets.js';
import type { GameMap } from '../data/types.js';
import {
  createPokemon,
  expForLevel,
  levelFromExp,
  maxHp,
  movesLearnedAt,
  makeMoveSlot,
  speciesOf,
  MAX_LEVEL,
  MOVE_SLOTS,
  type Pokemon,
  type PokemonContext,
} from '../pokemon/pokemon.js';
import { levelRangeOf, speciesInMap } from '../world/encounters.js';
import type { Expedition, SaveData } from '../save/schema.js';

export interface ExpeditionOption {
  id: string;
  label: string;
  durationMs: number;
  /** Multiplicador de recompensa em relacao a expedicao mais curta. */
  weight: number;
}

export const EXPEDITION_OPTIONS: ExpeditionOption[] = [
  { id: 'short', label: '15 minutos', durationMs: 15 * 60_000, weight: 1 },
  { id: 'medium', label: '1 hora', durationMs: 60 * 60_000, weight: 4.5 },
  { id: 'long', label: '4 horas', durationMs: 4 * 60 * 60_000, weight: 20 },
  { id: 'overnight', label: '8 horas', durationMs: 8 * 60 * 60_000, weight: 44 },
];

/** Quantas expedicoes cabem ao mesmo tempo, pelo nivel de treinador. */
export function expeditionSlots(trainerLevel: number): number {
  if (trainerLevel >= 25) return 3;
  if (trainerLevel >= 10) return 2;
  return 1;
}

export interface ExpeditionRewards {
  expPerPokemon: number;
  money: number;
  items: { id: string; count: number }[];
  found: Pokemon | null;
  eggSpecies: number | null;
  leveled: { uid: string; from: number; to: number }[];
}

export function isReady(expedition: Expedition, now = Date.now()): boolean {
  return now >= expedition.endsAt;
}

export function remainingMs(expedition: Expedition, now = Date.now()): number {
  return Math.max(0, expedition.endsAt - now);
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Pronta';
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function startExpedition(
  map: GameMap,
  team: Pokemon[],
  option: ExpeditionOption,
  mapName: string,
): Expedition {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    mapId: map.id,
    mapName,
    team: team.map((p) => p.uid),
    startedAt: now,
    endsAt: now + option.durationMs,
    durationMs: option.durationMs,
    collected: false,
  };
}

/**
 * Calcula o que a expedicao trouxe. A semente vem do id, entao o resultado e o
 * mesmo por mais que a tela seja aberta e fechada antes de resgatar.
 */
export async function resolveExpedition(
  ctx: PokemonContext,
  save: SaveData,
  expedition: Expedition,
): Promise<ExpeditionRewards> {
  const rng = new RNG(hash(expedition.id));
  const team = save.party
    .concat(save.box)
    .filter((p) => expedition.team.includes(p.uid));

  const option =
    EXPEDITION_OPTIONS.find((o) => o.durationMs === expedition.durationMs) ??
    EXPEDITION_OPTIONS[0];

  let map: GameMap | null = null;
  try {
    map = await loadMap(expedition.mapId);
  } catch {
    map = null;
  }

  const range = map ? levelRangeOf(map) : null;
  const areaLevel = range ? Math.round((range.min + range.max) / 2) : 5;
  const averageLevel =
    team.length > 0 ? team.reduce((acc, p) => acc + p.level, 0) / team.length : 5;

  // Uma equipe mais forte que a area rende mais, mas com retorno decrescente.
  const efficiency = Math.min(2, 0.6 + averageLevel / Math.max(4, areaLevel * 1.6));
  const expPerPokemon = Math.max(
    1,
    Math.round(areaLevel * 7 * option.weight * efficiency * (0.85 + rng.next() * 0.3)),
  );
  const money = Math.max(1, Math.round(areaLevel * 9 * option.weight * (0.8 + rng.next() * 0.4)));

  const items = rollItems(rng, option, areaLevel);

  // Chance de trazer um Pokemon da area, maior em expedicoes longas.
  const speciesPool = map ? speciesInMap(ctx, map) : [];
  const findChance = Math.min(0.75, 0.12 + option.weight * 0.015);
  let found: Pokemon | null = null;
  if (speciesPool.length > 0 && rng.chance(findChance)) {
    const species = rng.pick(speciesPool);
    const level = range ? rng.range(range.min, range.max) : Math.max(2, areaLevel);
    found = createPokemon(ctx, rng, {
      species,
      level,
      // Shiny e bem mais raro aqui do que no jogo ativo: a caçada vale a pena.
      shinyChance: 1 / 8192,
      caughtAtMap: expedition.mapId,
      caughtWith: 'expedicao',
    });
  }

  const eggSpecies =
    speciesPool.length > 0 && rng.chance(Math.min(0.3, option.weight * 0.012))
      ? baseFormOf(ctx, rng.pick(speciesPool))
      : null;

  // Aplica a EXP na equipe que foi.
  const leveled: ExpeditionRewards['leveled'] = [];
  for (const pokemon of team) {
    if (pokemon.level >= MAX_LEVEL) continue;
    const before = pokemon.level;
    const growth = speciesOf(ctx, pokemon).growth;
    pokemon.exp += expPerPokemon;
    const after = levelFromExp(growth, pokemon.exp);
    if (after > before) {
      const beforeMax = maxHp(ctx, pokemon);
      pokemon.level = after;
      pokemon.hp = Math.min(maxHp(ctx, pokemon), pokemon.hp + (maxHp(ctx, pokemon) - beforeMax));
      for (let level = before + 1; level <= after; level++) {
        for (const moveId of movesLearnedAt(ctx, pokemon.species, level)) {
          if (pokemon.moves.some((m) => m.id === moveId)) continue;
          if (pokemon.moves.length < MOVE_SLOTS) pokemon.moves.push(makeMoveSlot(ctx, moveId));
        }
      }
      leveled.push({ uid: pokemon.uid, from: before, to: after });
    }
    // Mantem a EXP coerente com o nivel alcancado.
    pokemon.exp = Math.max(pokemon.exp, expForLevel(growth, pokemon.level));
  }

  return { expPerPokemon, money, items, found, eggSpecies, leveled };
}

function rollItems(rng: RNG, option: ExpeditionOption, areaLevel: number): { id: string; count: number }[] {
  const pool: { id: string; weight: number }[] = [
    { id: 'pokeball', weight: 5 },
    { id: 'potion', weight: 4 },
    { id: 'greatball', weight: areaLevel > 12 ? 3 : 0.5 },
    { id: 'superpotion', weight: areaLevel > 15 ? 3 : 0.5 },
    { id: 'ultraball', weight: areaLevel > 28 ? 2 : 0.2 },
    { id: 'hyperpotion', weight: areaLevel > 30 ? 2 : 0.2 },
    { id: 'revive', weight: 0.8 },
  ];

  const draws = 1 + Math.floor(option.weight / 8);
  const tally = new Map<string, number>();
  for (let i = 0; i < draws; i++) {
    const pick = rng.weighted(pool, (p) => p.weight);
    const count = 1 + rng.int(Math.max(1, Math.floor(option.weight / 6)));
    tally.set(pick.id, (tally.get(pick.id) ?? 0) + count);
  }
  return [...tally.entries()].map(([id, count]) => ({ id, count }));
}

/** Ovos chocam a forma mais basica da linha evolutiva. */
function baseFormOf(ctx: PokemonContext, species: number): number {
  let current = species;
  for (let i = 0; i < 4; i++) {
    const prevo = ctx.species[String(current)]?.prevo;
    if (prevo === null || prevo === undefined) break;
    current = prevo;
  }
  return current;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
