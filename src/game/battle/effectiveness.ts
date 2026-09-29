/**
 * Efetividade de tipo pela tabela gerada. O simulador tem a dele; esta serve a
 * IA do oponente, que estima o dano antes de escolher o golpe.
 */
import type { PokemonType, TypeChart } from '../data/types.js';
import type { Effectiveness } from './types.js';

export function typeEffectiveness(
  chart: TypeChart,
  moveType: PokemonType,
  defenderTypes: PokemonType[],
): number {
  let total = 1;
  for (const type of defenderTypes) total *= chart[moveType]?.[type] ?? 1;
  return total;
}

export function describeEffectiveness(multiplier: number): Effectiveness {
  if (multiplier === 0) return 'immune';
  if (multiplier < 1) return 'resisted';
  if (multiplier > 1) return 'super';
  return 'normal';
}
