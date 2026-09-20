/**
 * Instancia de Pokemon: criacao, stats, EXP e aprendizado de golpes.
 * As formulas seguem a Geracao 5/6, que e a que o jogo imita.
 */
import type { RNG } from '../core/rng.js';
import type {
  GrowthRate,
  LearnsetsFile,
  MoveData,
  MovesFile,
  NaturesFile,
  SpeciesData,
  SpeciesFile,
  StatName,
  StatusName,
} from '../data/types.js';

export const MAX_LEVEL = 100;
export const MOVE_SLOTS = 4;
/** Chance base de shiny na Geracao 6. */
export const SHINY_ODDS = 1 / 4096;

export interface MoveSlot {
  id: string;
  pp: number;
  maxPp: number;
}

export interface Pokemon {
  /** Identificador unico desta criatura, estavel no save. */
  uid: string;
  species: number;
  nickname: string | null;
  level: number;
  exp: number;
  ivs: number[];
  evs: number[];
  nature: string;
  ability: string;
  gender: 'M' | 'F' | 'N';
  shiny: boolean;
  hp: number;
  status: StatusName | null;
  /** Turnos restantes de sono. */
  sleepTurns: number;
  moves: MoveSlot[];
  friendship: number;
  heldItem: string | null;
  /** Timestamp da captura, usado na Pokedex e nas medalhas. */
  caughtAt: number;
  caughtAtMap: string | null;
  caughtWith: string | null;
}

export interface PokemonContext {
  species: SpeciesFile;
  moves: MovesFile;
  learnsets: LearnsetsFile;
  natures: NaturesFile;
}

export function speciesOf(ctx: PokemonContext, pokemon: Pokemon): SpeciesData {
  const data = ctx.species[String(pokemon.species)];
  if (!data) throw new Error(`especie desconhecida: ${pokemon.species}`);
  return data;
}

export function displayName(ctx: PokemonContext, pokemon: Pokemon): string {
  return pokemon.nickname ?? speciesOf(ctx, pokemon).n;
}

// --- Stats ------------------------------------------------------------------

const STAT_INDEX: Record<StatName, number> = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };

export function statValue(ctx: PokemonContext, pokemon: Pokemon, stat: StatName): number {
  const data = speciesOf(ctx, pokemon);
  const i = STAT_INDEX[stat];
  const base = data.bs[i];
  const iv = pokemon.ivs[i] ?? 0;
  const ev = pokemon.evs[i] ?? 0;
  const level = pokemon.level;

  if (stat === 'hp') {
    // Shedinja e o unico com 1 de HP fixo.
    if (base === 1) return 1;
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }

  const raw = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  return Math.floor(raw * natureMultiplier(ctx, pokemon.nature, stat));
}

export function maxHp(ctx: PokemonContext, pokemon: Pokemon): number {
  return statValue(ctx, pokemon, 'hp');
}

function natureMultiplier(ctx: PokemonContext, nature: string, stat: StatName): number {
  const data = ctx.natures[nature];
  if (!data) return 1;
  if (data.plus === stat && data.minus !== stat) return 1.1;
  if (data.minus === stat && data.plus !== stat) return 0.9;
  return 1;
}

// --- Curvas de experiencia --------------------------------------------------

/** EXP total necessaria para chegar ao nivel n. */
export function expForLevel(growth: GrowthRate, level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, level));
  switch (growth) {
    case 'fast':
      return Math.floor((4 * n ** 3) / 5);
    case 'medium':
      return n ** 3;
    case 'slow':
      return Math.floor((5 * n ** 3) / 4);
    case 'medium-slow':
      return Math.max(0, Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140));
    case 'erratic':
      if (n <= 50) return Math.floor((n ** 3 * (100 - n)) / 50);
      if (n <= 68) return Math.floor((n ** 3 * (150 - n)) / 100);
      if (n <= 98) return Math.floor((n ** 3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n ** 3 * (160 - n)) / 100);
    case 'fluctuating':
      if (n <= 15) return Math.floor((n ** 3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n <= 36) return Math.floor((n ** 3 * (n + 14)) / 50);
      return Math.floor((n ** 3 * (Math.floor(n / 2) + 32)) / 50);
  }
}

export function levelFromExp(growth: GrowthRate, exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && exp >= expForLevel(growth, level + 1)) level++;
  return level;
}

/** Progresso 0..1 dentro do nivel atual, para a barra de EXP. */
export function expProgress(ctx: PokemonContext, pokemon: Pokemon): number {
  const growth = speciesOf(ctx, pokemon).growth;
  if (pokemon.level >= MAX_LEVEL) return 1;
  const current = expForLevel(growth, pokemon.level);
  const next = expForLevel(growth, pokemon.level + 1);
  if (next === current) return 1;
  return Math.max(0, Math.min(1, (pokemon.exp - current) / (next - current)));
}

/** EXP ganha ao derrotar um Pokemon (formula da Geracao 5). */
export function expGained(
  ctx: PokemonContext,
  defeated: Pokemon,
  winnerLevel: number,
  options: { trainerBattle: boolean; participants: number },
): number {
  const base = speciesOf(ctx, defeated).baseExp;
  const a = options.trainerBattle ? 1.5 : 1;
  const raw = (base * defeated.level * a) / (5 * Math.max(1, options.participants));
  const scale = (2 * defeated.level + 10) / (defeated.level + winnerLevel + 10);
  return Math.max(1, Math.floor(raw * scale ** 2.5 + 1));
}

// --- Criacao ----------------------------------------------------------------

export interface CreateOptions {
  species: number;
  level: number;
  shinyChance?: number;
  forceShiny?: boolean;
  ability?: string;
  moves?: string[];
  caughtAtMap?: string | null;
  caughtWith?: string | null;
}

export function createPokemon(ctx: PokemonContext, rng: RNG, options: CreateOptions): Pokemon {
  const data = ctx.species[String(options.species)];
  if (!data) throw new Error(`especie desconhecida: ${options.species}`);

  const natureIds = Object.keys(ctx.natures);
  const level = Math.max(1, Math.min(MAX_LEVEL, options.level));
  const moves = (options.moves ?? defaultMoveset(ctx, options.species, level)).map((id) =>
    makeMoveSlot(ctx, id),
  );

  const pokemon: Pokemon = {
    uid: `${Date.now().toString(36)}-${rng.int(0xffffff).toString(36)}`,
    species: options.species,
    nickname: null,
    level,
    exp: expForLevel(data.growth, level),
    ivs: Array.from({ length: 6 }, () => rng.int(32)),
    evs: [0, 0, 0, 0, 0, 0],
    nature: rng.pick(natureIds),
    ability: options.ability ?? rng.pick(data.ab.length > 0 ? data.ab : ['']),
    gender: rollGender(data, rng),
    shiny: options.forceShiny ?? rng.chance(options.shinyChance ?? SHINY_ODDS),
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves,
    friendship: data.friendship,
    heldItem: null,
    caughtAt: Date.now(),
    caughtAtMap: options.caughtAtMap ?? null,
    caughtWith: options.caughtWith ?? null,
  };
  pokemon.hp = maxHp(ctx, pokemon);
  return pokemon;
}

function rollGender(data: SpeciesData, rng: RNG): 'M' | 'F' | 'N' {
  if (data.gr < 0) return 'N';
  return rng.next() < data.gr ? 'M' : 'F';
}

export function makeMoveSlot(ctx: PokemonContext, id: string): MoveSlot {
  const move = ctx.moves[id];
  const pp = move?.pp ?? 5;
  return { id, pp, maxPp: pp };
}

/**
 * Os quatro golpes mais recentes que a especie sabe no nivel dado. Empates de
 * nivel sao resolvidos pelo golpe mais forte, para nao entregar um selvagem
 * cheio de golpes de status.
 */
export function defaultMoveset(ctx: PokemonContext, species: number, level: number): string[] {
  const learnset = ctx.learnsets[String(species)] ?? [];
  const available = learnset
    .filter(([lvl, id]) => lvl <= level && ctx.moves[id])
    .sort((a, b) => a[0] - b[0] || power(ctx.moves[a[1]]) - power(ctx.moves[b[1]]));

  const chosen: string[] = [];
  for (let i = available.length - 1; i >= 0 && chosen.length < MOVE_SLOTS; i--) {
    const id = available[i][1];
    if (!chosen.includes(id)) chosen.push(id);
  }
  return chosen.length > 0 ? chosen.reverse() : ['tackle'];
}

function power(move: MoveData | undefined): number {
  if (!move) return 0;
  return move.cat === 'Status' ? 10 : move.bp;
}

/** Golpes que a especie aprende exatamente ao chegar neste nivel. */
export function movesLearnedAt(ctx: PokemonContext, species: number, level: number): string[] {
  return (ctx.learnsets[String(species)] ?? [])
    .filter(([lvl, id]) => lvl === level && ctx.moves[id])
    .map(([, id]) => id);
}

/** Evolucao disponivel ao subir de nivel, se houver. */
export function evolutionAt(ctx: PokemonContext, pokemon: Pokemon): number | null {
  const data = speciesOf(ctx, pokemon);
  for (const evo of data.evos) {
    if (evo.kind === 'level' && evo.level !== null && pokemon.level >= evo.level) return evo.to;
  }
  return null;
}

export function healFully(ctx: PokemonContext, pokemon: Pokemon): void {
  pokemon.hp = maxHp(ctx, pokemon);
  pokemon.status = null;
  pokemon.sleepTurns = 0;
  for (const move of pokemon.moves) move.pp = move.maxPp;
}

export function isFainted(pokemon: Pokemon): boolean {
  return pokemon.hp <= 0;
}
