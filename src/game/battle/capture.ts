/**
 * Captura com a formula da Geracao 5/6: taxa modificada, valor b e quatro
 * checagens de balanco -- o que faz a bola chacoalhar de uma a tres vezes antes
 * de escapar.
 */
import type { RNG } from '../core/rng.js';
import type { Pokemon, PokemonContext } from '../pokemon/pokemon.js';
import { maxHp, speciesOf } from '../pokemon/pokemon.js';

export interface BallData {
  id: string;
  name: string;
  /** Multiplicador fixo; bolas com condicao usam `bonus`. */
  rate: number;
  price: number;
  description: string;
  bonus?: (ctx: CaptureContext) => number;
}

export interface CaptureContext {
  target: Pokemon;
  targetLevel: number;
  playerLevel: number;
  turn: number;
  isCave: boolean;
  isWater: boolean;
  isNight: boolean;
  isFirstTurn: boolean;
}

export const BALLS: Record<string, BallData> = {
  pokeball: { id: 'pokeball', name: 'Poke Ball', rate: 1, price: 200, description: 'A bola padrao.' },
  greatball: { id: 'greatball', name: 'Great Ball', rate: 1.5, price: 600, description: 'Melhor que a comum.' },
  ultraball: { id: 'ultraball', name: 'Ultra Ball', rate: 2, price: 1200, description: 'Alta taxa de captura.' },
  masterball: {
    id: 'masterball',
    name: 'Master Ball',
    rate: 255,
    price: 0,
    description: 'Captura sem falhar. Nao se compra.',
  },
  netball: {
    id: 'netball',
    name: 'Net Ball',
    rate: 1,
    price: 1000,
    description: 'Otima contra Pokemon de Agua e Inseto.',
    bonus: () => 1,
  },
  nestball: {
    id: 'nestball',
    name: 'Nest Ball',
    rate: 1,
    price: 1000,
    description: 'Funciona melhor com Pokemon de nivel baixo.',
    bonus: (ctx) => Math.max(1, (41 - ctx.targetLevel) / 10),
  },
  duskball: {
    id: 'duskball',
    name: 'Dusk Ball',
    rate: 1,
    price: 1000,
    description: 'Eficaz em cavernas e a noite.',
    bonus: (ctx) => (ctx.isCave || ctx.isNight ? 3 : 1),
  },
  quickball: {
    id: 'quickball',
    name: 'Quick Ball',
    rate: 1,
    price: 1000,
    description: 'Forte no primeiro turno do combate.',
    bonus: (ctx) => (ctx.isFirstTurn ? 5 : 1),
  },
  timerball: {
    id: 'timerball',
    name: 'Timer Ball',
    rate: 1,
    price: 1000,
    description: 'Fica melhor a cada turno que passa.',
    bonus: (ctx) => Math.min(4, 1 + ctx.turn * 0.3),
  },
};

const STATUS_BONUS: Record<string, number> = {
  slp: 2.5,
  frz: 2.5,
  par: 1.5,
  psn: 1.5,
  tox: 1.5,
  brn: 1.5,
};

export interface CaptureResult {
  caught: boolean;
  /** Quantas vezes a bola chacoalhou (0 a 3), ou 4 quando prende. */
  shakes: number;
}

export function attemptCapture(
  ctx: PokemonContext,
  rng: RNG,
  ballId: string,
  target: Pokemon,
  captureCtx: CaptureContext,
): CaptureResult {
  const ball = BALLS[ballId] ?? BALLS.pokeball;
  if (ball.rate >= 255) return { caught: true, shakes: 4 };

  const species = speciesOf(ctx, target);
  const hpMax = maxHp(ctx, target);
  const ballRate = ball.bonus ? ball.bonus(captureCtx) : ball.rate;
  const statusBonus = target.status ? (STATUS_BONUS[target.status] ?? 1) : 1;

  // a = ((3*HPmax - 2*HPatual) * taxa * bola) / (3*HPmax) * status
  const a =
    (((3 * hpMax - 2 * Math.max(1, target.hp)) * species.catch * ballRate) / (3 * hpMax)) *
    statusBonus;

  if (a >= 255) return { caught: true, shakes: 4 };

  const b = 65536 / (255 / a) ** 0.1875;
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (rng.int(65536) >= b) return { caught: false, shakes };
    shakes++;
  }
  return { caught: true, shakes: 4 };
}

/** Chance de fuga do jogador contra um selvagem (formula da Geracao 3+). */
export function escapeChance(playerSpeed: number, foeSpeed: number, attempts: number): number {
  if (playerSpeed > foeSpeed) return 1;
  const odds = (Math.floor((playerSpeed * 128) / Math.max(1, foeSpeed)) + 30 * attempts) % 256;
  return Math.min(1, odds / 256);
}
