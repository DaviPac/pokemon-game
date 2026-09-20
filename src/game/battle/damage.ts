/**
 * Formula de dano da Geracao 5/6 e o que gira em torno dela: efetividade de
 * tipo, critico, STAB e os estagios de atributo.
 */
import type { RNG } from '../core/rng.js';
import type { MoveData, PokemonType, StatName, TypeChart } from '../data/types.js';
import type { Pokemon, PokemonContext } from '../pokemon/pokemon.js';
import { speciesOf, statValue } from '../pokemon/pokemon.js';
import type { ActiveState, Effectiveness } from './types.js';

/** Multiplicadores dos estagios -6..+6 para atributos de combate. */
const STAGE_MULTIPLIERS = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 2, 5 / 2, 3, 7 / 2, 4];
/** Precisao e evasao usam uma tabela propria. */
const ACC_MULTIPLIERS = [3 / 9, 3 / 8, 3 / 7, 3 / 6, 3 / 5, 3 / 4, 1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3];

export function stageMultiplier(stage: number): number {
  return STAGE_MULTIPLIERS[clampStage(stage) + 6];
}

export function accuracyMultiplier(stage: number): number {
  return ACC_MULTIPLIERS[clampStage(stage) + 6];
}

export function clampStage(stage: number): number {
  return Math.max(-6, Math.min(6, stage));
}

export function effectiveStat(
  ctx: PokemonContext,
  pokemon: Pokemon,
  state: ActiveState,
  stat: Exclude<StatName, 'hp'>,
  ignoreBoosts = false,
): number {
  const base = statValue(ctx, pokemon, stat);
  const boosted = ignoreBoosts ? base : Math.floor(base * stageMultiplier(state.boosts[stat]));
  // Paralisia corta a velocidade pela metade (Geracao 7 usa 1/2; ate a 6, 1/4).
  if (stat === 'spe' && pokemon.status === 'par') return Math.floor(boosted / 4);
  return Math.max(1, boosted);
}

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

export interface DamageResult {
  damage: number;
  crit: boolean;
  effectiveness: number;
}

export function calculateDamage(
  ctx: PokemonContext,
  chart: TypeChart,
  rng: RNG,
  attacker: Pokemon,
  attackerState: ActiveState,
  defender: Pokemon,
  defenderState: ActiveState,
  move: MoveData,
): DamageResult {
  const defenderTypes = speciesOf(ctx, defender).t;
  const effectiveness = typeEffectiveness(chart, move.t, defenderTypes);
  if (effectiveness === 0 && !move.ignoreImmunity) {
    return { damage: 0, crit: false, effectiveness: 0 };
  }

  const physical = move.cat === 'Physical';
  const crit = move.willCrit || rollCrit(rng, move.crit);

  // Num critico, ignoramos os boosts que ajudariam o defensor e as quedas do atacante.
  const attackStat = physical ? 'atk' : 'spa';
  const defenseStat = physical ? 'def' : 'spd';
  const attack = effectiveStat(
    ctx,
    attacker,
    attackerState,
    attackStat,
    crit && attackerState.boosts[attackStat] < 0,
  );
  const defense = effectiveStat(
    ctx,
    defender,
    defenderState,
    defenseStat,
    crit && defenderState.boosts[defenseStat] > 0,
  );

  const level = attacker.level;
  const base = Math.floor(
    Math.floor((Math.floor((2 * level) / 5 + 2) * move.bp * attack) / defense) / 50,
  ) + 2;

  let damage = base;
  if (crit) damage = Math.floor(damage * 1.5);
  damage = Math.floor((damage * rng.range(85, 100)) / 100);

  const attackerTypes = speciesOf(ctx, attacker).t;
  if (attackerTypes.includes(move.t)) damage = Math.floor(damage * 1.5);

  damage = Math.floor(damage * effectiveness);

  // Queimadura corta o ataque fisico pela metade.
  if (attacker.status === 'brn' && physical) damage = Math.floor(damage / 2);

  return { damage: Math.max(1, damage), crit, effectiveness };
}

/** Chance de critico da Geracao 6: 1/16 no estagio 0. */
function rollCrit(rng: RNG, critRatio: number): boolean {
  const odds = [16, 8, 2, 1];
  const denominator = odds[Math.min(odds.length - 1, Math.max(0, critRatio - 1))];
  return rng.next() < 1 / denominator;
}

export function accuracyCheck(
  rng: RNG,
  move: MoveData,
  attackerState: ActiveState,
  defenderState: ActiveState,
): boolean {
  if (move.acc === null) return true;
  const modifier =
    accuracyMultiplier(attackerState.boosts.accuracy) /
    accuracyMultiplier(defenderState.boosts.evasion);
  return rng.next() * 100 < move.acc * modifier;
}

/** Dano fixo do golpe de confusao (40 de poder, fisico, sem tipo). */
export function confusionDamage(
  ctx: PokemonContext,
  rng: RNG,
  pokemon: Pokemon,
  state: ActiveState,
): number {
  const attack = effectiveStat(ctx, pokemon, state, 'atk');
  const defense = effectiveStat(ctx, pokemon, state, 'def');
  const base =
    Math.floor(Math.floor((Math.floor((2 * pokemon.level) / 5 + 2) * 40 * attack) / defense) / 50) + 2;
  return Math.max(1, Math.floor((base * rng.range(85, 100)) / 100));
}
