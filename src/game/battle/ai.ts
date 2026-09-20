/**
 * IA do oponente. Um selvagem ataca quase ao acaso; um treinador escolhe o
 * golpe mais eficiente e troca quando esta em desvantagem clara.
 */
import type { RNG } from '../core/rng.js';
import type { TypeChart } from '../data/types.js';
import type { PokemonContext } from '../pokemon/pokemon.js';
import { isFainted, maxHp } from '../pokemon/pokemon.js';
import type { Battle } from './engine.js';
import type { BattleAction } from './types.js';

export function chooseFoeAction(
  ctx: PokemonContext,
  chart: TypeChart,
  rng: RNG,
  battle: Battle,
): BattleAction {
  void chart;
  const foe = battle.active('foe');
  const usable = foe.moves
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.pp > 0 && ctx.moves[slot.id]);

  if (usable.length === 0) return { kind: 'move', index: 0 };

  const trainer = battle.config.kind === 'trainer';

  // Treinador em apuros troca para alguem com vantagem, de vez em quando.
  if (trainer && foe.hp < maxHp(ctx, foe) * 0.25 && rng.chance(0.35)) {
    const alternative = battle.foe.party.findIndex(
      (p, i) => i !== battle.foe.activeIndex && !isFainted(p),
    );
    if (alternative >= 0) return { kind: 'switch', index: alternative };
  }

  const scored = usable.map(({ slot, index }) => {
    const move = ctx.moves[slot.id]!;
    let score = battle.estimateDamage('foe', slot.id);
    if (move.cat === 'Status') {
      // Golpes de status valem algo no comeco do combate, pouco depois.
      score = battle.turn <= 2 ? 18 : 4;
      if (move.status && battle.active('player').status) score = 0;
    }
    return { index, score };
  });

  if (!trainer) {
    // Selvagens sao imprevisiveis: peso leve para o melhor golpe.
    const weights = scored.map((s) => ({ ...s, weight: 1 + s.score * 0.05 }));
    return { kind: 'move', index: rng.weighted(weights, (w) => w.weight).index };
  }

  // Treinador: melhor golpe, com um empurrao aleatorio para nao ficar robotico.
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (rng.chance(0.15)) return { kind: 'move', index: rng.pick(scored).index };
  return { kind: 'move', index: best.index };
}
