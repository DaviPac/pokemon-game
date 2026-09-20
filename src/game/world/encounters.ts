/**
 * Sorteio de encontros selvagens a partir das tabelas reais do FireRed.
 */
import type { RNG } from '../core/rng.js';
import type { EncounterSlot, EncounterTable, GameMap } from '../data/types.js';
import { createPokemon, type Pokemon, type PokemonContext } from '../pokemon/pokemon.js';

/** SPECIES_PIKACHU -> 25, usando o nome da especie no dex gerado. */
export function speciesIdFromConstant(ctx: PokemonContext, constant: string): number | null {
  const name = constant.replace(/^SPECIES_/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cached = constantCache.get(name);
  if (cached !== undefined) return cached;

  for (const [id, data] of Object.entries(ctx.species)) {
    const normalized = data.n.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === name) {
      const num = Number(id);
      constantCache.set(name, num);
      return num;
    }
  }
  constantCache.set(name, null as unknown as number);
  return null;
}

const constantCache = new Map<string, number>();

export interface WildEncounter {
  pokemon: Pokemon;
  slot: EncounterSlot;
}

export function rollEncounter(
  ctx: PokemonContext,
  rng: RNG,
  map: GameMap,
  kind: 'land' | 'water',
  options: { shinyChanceFor?: (species: number) => number } = {},
): WildEncounter | null {
  const table: EncounterTable | undefined =
    kind === 'land' ? map.encounters?.land : map.encounters?.water;
  if (!table || table.slots.length === 0) return null;

  const slot = rng.weighted(table.slots, (s) => s.weight);
  const species = speciesIdFromConstant(ctx, slot.species);
  if (species === null) return null;

  const level = rng.range(slot.min, slot.max);
  const pokemon = createPokemon(ctx, rng, {
    species,
    level,
    // A corrente de capturas so e conhecida depois de sabermos a especie.
    shinyChance: options.shinyChanceFor?.(species),
    caughtAtMap: map.id,
  });
  return { pokemon, slot };
}

/** Todas as especies que um mapa pode gerar — usado pela Pokedex e pelas expedicoes. */
export function speciesInMap(ctx: PokemonContext, map: GameMap): number[] {
  const ids = new Set<number>();
  const add = (slots: EncounterSlot[] | undefined) => {
    for (const slot of slots ?? []) {
      const id = speciesIdFromConstant(ctx, slot.species);
      if (id !== null) ids.add(id);
    }
  };
  add(map.encounters?.land?.slots);
  add(map.encounters?.water?.slots);
  add(map.encounters?.rockSmash?.slots);
  for (const rod of Object.values(map.encounters?.fishing ?? {})) add(rod);
  return [...ids];
}

/** Faixa de niveis encontrada no mapa, para dimensionar as expedicoes. */
export function levelRangeOf(map: GameMap): { min: number; max: number } | null {
  const slots = [
    ...(map.encounters?.land?.slots ?? []),
    ...(map.encounters?.water?.slots ?? []),
  ];
  if (slots.length === 0) return null;
  return {
    min: Math.min(...slots.map((s) => s.min)),
    max: Math.max(...slots.map((s) => s.max)),
  };
}
