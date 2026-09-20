import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RNG } from '../core/rng.js';
import type { TypeChart } from '../data/types.js';
import {
  createPokemon,
  defaultMoveset,
  expForLevel,
  levelFromExp,
  maxHp,
  statValue,
  type Pokemon,
  type PokemonContext,
} from '../pokemon/pokemon.js';
import { attemptCapture } from './capture.js';
import { typeEffectiveness } from './damage.js';
import { Battle } from './engine.js';

const DATA = join(process.cwd(), 'public', 'assets', 'data');

let ctx: PokemonContext;
let chart: TypeChart;

beforeAll(async () => {
  const read = async (name: string) => JSON.parse(await readFile(join(DATA, name), 'utf8'));
  ctx = {
    species: await read('species.json'),
    moves: await read('moves.json'),
    learnsets: await read('learnsets.json'),
    natures: await read('natures.json'),
  };
  chart = await read('typechart.json');
});

function make(species: number, level: number, overrides: Partial<Pokemon> = {}): Pokemon {
  const pokemon = createPokemon(ctx, new RNG(1234), { species, level });
  Object.assign(pokemon, overrides);
  pokemon.hp = maxHp(ctx, pokemon);
  return pokemon;
}

describe('dados gerados', () => {
  it('cobre as 721 especies ate Kalos', () => {
    expect(Object.keys(ctx.species)).toHaveLength(721);
    expect(ctx.species['1'].n).toBe('Bulbasaur');
    expect(ctx.species['721'].n).toBe('Volcanion');
  });

  it('tem a tabela de tipos da Geracao 6, com Fada', () => {
    expect(typeEffectiveness(chart, 'Fairy', ['Dragon'])).toBe(2);
    expect(typeEffectiveness(chart, 'Dragon', ['Fairy'])).toBe(0);
    expect(typeEffectiveness(chart, 'Electric', ['Ground'])).toBe(0);
    expect(typeEffectiveness(chart, 'Water', ['Rock', 'Ground'])).toBe(4);
    expect(typeEffectiveness(chart, 'Fighting', ['Rock', 'Ground'])).toBe(2);
    expect(typeEffectiveness(chart, 'Water', ['Water', 'Dragon'])).toBe(0.25);
  });
});

describe('stats', () => {
  it('calcula HP e atributos pela formula da Geracao 3+', () => {
    // Garchomp nivel 78 do exemplo classico da Bulbapedia.
    const garchomp = make(445, 78, {
      ivs: [24, 12, 30, 16, 23, 5],
      evs: [74, 190, 91, 48, 84, 23],
      nature: 'adamant',
    });
    expect(maxHp(ctx, garchomp)).toBe(289);
    expect(statValue(ctx, garchomp, 'atk')).toBe(278);
    expect(statValue(ctx, garchomp, 'def')).toBe(193);
    expect(statValue(ctx, garchomp, 'spa')).toBe(135);
    expect(statValue(ctx, garchomp, 'spd')).toBe(171);
    expect(statValue(ctx, garchomp, 'spe')).toBe(171);
  });

  it('respeita o HP fixo de Shedinja', () => {
    expect(maxHp(ctx, make(292, 50))).toBe(1);
  });
});

describe('curvas de experiencia', () => {
  it('bate com os valores conhecidos no nivel 100', () => {
    expect(expForLevel('fast', 100)).toBe(800000);
    expect(expForLevel('medium', 100)).toBe(1000000);
    expect(expForLevel('medium-slow', 100)).toBe(1059860);
    expect(expForLevel('slow', 100)).toBe(1250000);
    expect(expForLevel('erratic', 100)).toBe(600000);
    expect(expForLevel('fluctuating', 100)).toBe(1640000);
  });

  it('converte EXP em nivel de volta', () => {
    for (const growth of ['fast', 'medium', 'slow', 'medium-slow'] as const) {
      for (const level of [1, 7, 23, 50, 99, 100]) {
        expect(levelFromExp(growth, expForLevel(growth, level))).toBe(level);
      }
    }
  });
});

describe('golpes iniciais', () => {
  it('da no maximo quatro golpes coerentes com o nivel', () => {
    const moves = defaultMoveset(ctx, 25, 15);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(4);
    for (const id of moves) expect(ctx.moves[id]).toBeDefined();
  });

  it('nao entrega golpe de nivel alto para um selvagem fraco', () => {
    const learnset = ctx.learnsets['1'];
    for (const id of defaultMoveset(ctx, 1, 5)) {
      const entry = learnset.find(([, move]) => move === id);
      expect(entry![0]).toBeLessThanOrEqual(5);
    }
  });
});

describe('captura', () => {
  it('a Master Ball nunca falha', () => {
    const target = make(150, 70); // Mewtwo, taxa 3
    const result = attemptCapture(ctx, new RNG(7), 'masterball', target, captureCtx(target));
    expect(result.caught).toBe(true);
  });

  it('enfraquecer e adormecer aumenta muito a chance', () => {
    const trials = 400;
    const healthy = countCaptures(trials, (rng) => {
      const target = make(19, 5); // Rattata, taxa 255
      return attemptCapture(ctx, rng, 'pokeball', target, captureCtx(target));
    });
    const weakened = countCaptures(trials, (rng) => {
      const target = make(19, 5);
      target.hp = 1;
      target.status = 'slp';
      return attemptCapture(ctx, rng, 'pokeball', target, captureCtx(target));
    });
    expect(weakened).toBeGreaterThan(healthy);
  });

  it('um lendario com HP cheio quase nunca cai numa Poke Ball', () => {
    const caught = countCaptures(300, (rng) => {
      const target = make(150, 70);
      return attemptCapture(ctx, rng, 'pokeball', target, captureCtx(target));
    });
    expect(caught).toBeLessThan(15);
  });
});

describe('batalha', () => {
  it('roda uma batalha selvagem ate alguem vencer', () => {
    const battle = newBattle();
    battle.start();

    let guard = 0;
    while (!battle.outcome && guard++ < 200) {
      if (battle.awaitingSwitch) {
        const next = battle.player.party.findIndex((p) => p.hp > 0);
        if (next < 0) break;
        battle.switchTo(next);
        continue;
      }
      battle.takeTurn({ kind: 'move', index: 0 });
    }

    expect(battle.outcome).not.toBeNull();
    expect(guard).toBeLessThan(200);
  });

  it('gera eventos de dano com a efetividade certa', () => {
    // Squirtle com Water Gun contra Charmander: deve ser muito eficaz.
    const player = make(7, 20, { moves: [{ id: 'watergun', pp: 25, maxPp: 25 }] });
    const foe = make(4, 20, { moves: [{ id: 'scratch', pp: 35, maxPp: 35 }] });
    const battle = new Battle(ctx, chart, new RNG(99), [player], [foe], {
      kind: 'wild',
      canRun: true,
    });
    battle.start();
    const events = battle.takeTurn({ kind: 'move', index: 0 });
    const damage = events.find((e) => e.t === 'damage' && e.side === 'foe');
    expect(damage).toBeDefined();
    expect(damage!.t === 'damage' && damage!.effectiveness).toBe('super');
  });

  it('nao deixa o HP passar do maximo nem ficar negativo', () => {
    const battle = newBattle();
    battle.start();
    for (let i = 0; i < 50 && !battle.outcome; i++) {
      if (battle.awaitingSwitch) break;
      battle.takeTurn({ kind: 'move', index: 0 });
      for (const side of ['player', 'foe'] as const) {
        const pokemon = battle.active(side);
        expect(pokemon.hp).toBeGreaterThanOrEqual(0);
        expect(pokemon.hp).toBeLessThanOrEqual(maxHp(ctx, pokemon));
      }
    }
  });

  it('da EXP ao derrotar o oponente', () => {
    const player = make(6, 50); // Charizard forte
    const foe = make(10, 3); // Caterpie fraquinho
    const before = player.exp;
    const battle = new Battle(ctx, chart, new RNG(5), [player], [foe], {
      kind: 'wild',
      canRun: true,
    });
    battle.start();
    let guard = 0;
    while (!battle.outcome && guard++ < 20) battle.takeTurn({ kind: 'move', index: 0 });
    expect(battle.outcome).toBe('win');
    expect(player.exp).toBeGreaterThan(before);
  });

  it('fugir de um treinador nao funciona', () => {
    const battle = new Battle(ctx, chart, new RNG(3), [make(6, 30)], [make(9, 30)], {
      kind: 'trainer',
      foeName: 'Rival',
      canRun: true,
    });
    battle.start();
    const events = battle.takeTurn({ kind: 'run' });
    expect(events.some((e) => e.t === 'text' && e.text.includes('treinador'))).toBe(true);
    expect(battle.outcome).toBeNull();
  });
});

function newBattle(): Battle {
  return new Battle(ctx, chart, new RNG(42), [make(1, 12), make(4, 12)], [make(16, 10)], {
    kind: 'wild',
    canRun: true,
  });
}

function captureCtx(target: Pokemon) {
  return {
    target,
    targetLevel: target.level,
    playerLevel: 10,
    turn: 1,
    isCave: false,
    isWater: false,
    isNight: false,
    isFirstTurn: true,
  };
}

function countCaptures(trials: number, run: (rng: RNG) => { caught: boolean }): number {
  let caught = 0;
  for (let i = 0; i < trials; i++) {
    if (run(new RNG(i * 7919 + 13)).caught) caught++;
  }
  return caught;
}
