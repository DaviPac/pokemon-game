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
import { typeEffectiveness } from './effectiveness.js';
import { Battle } from './engine.js';
import { ProtocolReader } from './protocol.js';
import type { BattleEvent } from './types.js';

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

  it('a velocidade decide quem ataca primeiro', () => {
    // Jolteon (129 de velocidade) contra Snorlax (42), os dois no nivel 50.
    const jolteon = make(135, 50, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] });
    const snorlax = make(143, 50, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] });

    const order = (player: Pokemon, foe: Pokemon): string[] => {
      const battle = new Battle(ctx, chart, new RNG(9), [player], [foe], {
        kind: 'wild',
        canRun: true,
      });
      battle.start();
      return battle
        .takeTurn({ kind: 'move', index: 0 })
        .filter((e) => e.t === 'useMove')
        .map((e) => (e.t === 'useMove' ? e.side : ''));
    };

    expect(order(clone(jolteon), clone(snorlax))[0]).toBe('player');
    expect(order(clone(snorlax), clone(jolteon))[0]).toBe('foe');
  });

  it('prioridade do golpe passa na frente da velocidade', () => {
    const jolteon = make(135, 50, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] });
    const snorlax = make(143, 50, { moves: [{ id: 'quickattack', pp: 30, maxPp: 30 }] });
    const battle = new Battle(ctx, chart, new RNG(9), [jolteon], [snorlax], {
      kind: 'wild',
      canRun: true,
    });
    battle.start();
    const order = battle
      .takeTurn({ kind: 'move', index: 0 })
      .filter((e) => e.t === 'useMove')
      .map((e) => (e.t === 'useMove' ? e.side : ''));
    expect(order[0]).toBe('foe');
  });

  it('os eventos carregam o HP do instante em que aconteceram', () => {
    // A interface anima o turno passo a passo: se o evento trouxesse o estado
    // final, a barra de HP cairia antes de o golpe aparecer.
    const player = make(6, 50, { moves: [{ id: 'ember', pp: 25, maxPp: 25 }] });
    const foe = make(10, 8, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] });
    const battle = new Battle(ctx, chart, new RNG(11), [player], [foe], {
      kind: 'wild',
      canRun: true,
    });

    const opening = battle.start();
    const sendOut = opening.find((e) => e.t === 'sendOut' && e.side === 'foe');
    expect(sendOut?.t === 'sendOut' && sendOut.hp).toBe(maxHp(ctx, foe));

    const events = battle.takeTurn({ kind: 'move', index: 0 });
    const damage = events.find((e) => e.t === 'damage' && e.side === 'foe');
    expect(damage?.t === 'damage' && damage.hp).toBe(
      Math.max(0, maxHp(ctx, foe) - (damage?.t === 'damage' ? damage.amount : 0)),
    );
  });

  it('o texto do golpe vem antes da animacao', () => {
    const battle = newBattle();
    battle.start();
    const events = battle.takeTurn({ kind: 'move', index: 0 });
    const textIndex = events.findIndex((e) => e.t === 'text' && e.text.includes('usou'));
    const moveIndex = events.findIndex((e) => e.t === 'useMove');
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeLessThan(moveIndex);
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

describe('batalha no simulador do Showdown', () => {
  const texts = (events: BattleEvent[]) =>
    events.flatMap((e) => (e.t === 'text' ? [e.text] : []));

  it('comeca do HP, do status e do PP salvos', () => {
    const player = make(4, 20, { moves: [{ id: 'scratch', pp: 7, maxPp: 35 }] });
    player.hp = 11;
    player.status = 'par';
    const battle = new Battle(ctx, chart, new RNG(21), [player], [make(10, 5)], { kind: 'wild', canRun: true });
    const opening = battle.start();
    const sendOut = opening.find((e) => e.t === 'sendOut' && e.side === 'player');
    expect(sendOut?.t === 'sendOut' && sendOut.hp).toBe(11);
    expect(sendOut?.t === 'sendOut' && sendOut.status).toBe('par');
    expect(battle.moveOptions()[0]).toMatchObject({ id: 'scratch', pp: 7, maxPp: 35 });

    battle.takeTurn({ kind: 'move', index: 0 });
    // Paralisado, ele pode perder a vez; se atacou, gastou um PP.
    expect(player.moves[0].pp).toBeLessThanOrEqual(7);
    expect(player.moves[0].pp).toBeGreaterThanOrEqual(6);
  });

  it('segue as habilidades do Showdown: Levitate ignora golpes de Terra', () => {
    const player = make(27, 30, { moves: [{ id: 'earthquake', pp: 10, maxPp: 10 }] });
    const gastly = make(92, 30, { ability: 'Levitate', moves: [{ id: 'lick', pp: 30, maxPp: 30 }] });
    const battle = new Battle(ctx, chart, new RNG(4), [player], [gastly], { kind: 'wild', canRun: true });
    battle.start();
    const events = battle.takeTurn({ kind: 'move', index: 0 });
    expect(events.some((e) => e.t === 'damage' && e.side === 'foe')).toBe(false);
    expect(texts(events).some((t) => /Levitate|Nao afeta/.test(t))).toBe(true);
  });

  it('a Potion cura e o oponente ainda age no mesmo turno', () => {
    const player = make(4, 12, { moves: [{ id: 'scratch', pp: 35, maxPp: 35 }] });
    player.hp = 5;
    const battle = new Battle(ctx, chart, new RNG(8), [player], [make(16, 4, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] })], {
      kind: 'wild',
      canRun: true,
    });
    battle.start();
    const events = battle.takeTurn({ kind: 'item', item: 'potion' });
    const heal = events.find((e) => e.t === 'heal' && e.side === 'player');
    expect(heal?.t === 'heal' && heal.hp).toBe(Math.min(maxHp(ctx, player), 25));
    // O jogador nao ataca: o unico golpe do turno e do oponente.
    const moves = events.filter((e) => e.t === 'useMove');
    expect(moves.map((e) => (e.t === 'useMove' ? e.side : ''))).toEqual(['foe']);
    expect(player.moves[0].pp).toBe(35);
  });

  it('bola que falha passa a vez para o selvagem', () => {
    const player = make(4, 12);
    const foe = make(150, 70, { moves: [{ id: 'confusion', pp: 25, maxPp: 25 }] });
    const battle = new Battle(ctx, chart, new RNG(2), [player], [foe], { kind: 'wild', canRun: true });
    battle.start();
    const events = battle.throwBall('pokeball', { playerLevel: 5, isCave: false, isWater: false, isNight: false });
    const ball = events.find((e) => e.t === 'ball');
    if (ball?.t === 'ball' && !ball.caught) {
      expect(events.some((e) => e.t === 'useMove' && e.side === 'foe')).toBe(true);
    }
  });

  it('nocaute pede troca, e a troca continua o combate', () => {
    const weak = make(10, 2, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] });
    const backup = make(4, 20, { moves: [{ id: 'scratch', pp: 35, maxPp: 35 }] });
    const foe = make(68, 50, { moves: [{ id: 'karatechop', pp: 25, maxPp: 25 }] });
    const battle = new Battle(ctx, chart, new RNG(6), [weak, backup], [foe], { kind: 'trainer', foeName: 'Rival', canRun: false });
    battle.start();
    const events = battle.takeTurn({ kind: 'move', index: 0 });
    expect(events.some((e) => e.t === 'faint' && e.side === 'player')).toBe(true);
    expect(events[events.length - 1]).toEqual({ t: 'prompt', kind: 'chooseSwitch' });
    expect(battle.awaitingSwitch).toBe(true);

    const next = battle.switchTo(1);
    expect(next.some((e) => e.t === 'sendOut' && e.side === 'player' && e.index === 1)).toBe(true);
    expect(battle.awaitingSwitch).toBe(false);
    expect(battle.active('player')).toBe(backup);
  });

  it('quem ja chegou desmaiado nao entra, e a derrota vem quando todos caem', () => {
    const fainted = make(1, 10);
    fainted.hp = 0;
    const last = make(10, 2, { moves: [{ id: 'tackle', pp: 35, maxPp: 35 }] });
    const foe = make(68, 60, { moves: [{ id: 'karatechop', pp: 25, maxPp: 25 }] });
    const battle = new Battle(ctx, chart, new RNG(1), [fainted, last], [foe], { kind: 'wild', canRun: true });
    const opening = battle.start();
    expect(opening.find((e) => e.t === 'sendOut' && e.side === 'player')).toMatchObject({ index: 1 });
    const events = battle.takeTurn({ kind: 'move', index: 0 });
    expect(battle.outcome).toBe('loss');
    expect(events[events.length - 1]).toEqual({ t: 'end', outcome: 'loss' });
  });

  it('subir de nivel no meio da batalha vale para o simulador tambem', () => {
    const player = make(6, 30, { moves: [{ id: 'flamethrower', pp: 15, maxPp: 15 }] });
    player.exp = expForLevel(ctx.species['6'].growth, 31) - 1;
    const foes = [make(10, 20), make(13, 20)];
    const battle = new Battle(ctx, chart, new RNG(12), [player], foes, { kind: 'trainer', foeName: 'Inseto', canRun: false });
    battle.start();
    const events = battle.takeTurn({ kind: 'move', index: 0 });
    const exp = events.find((e) => e.t === 'exp');
    expect(exp?.t === 'exp' && exp.leveledUp).toBe(true);
    expect(player.level).toBe(31);
    // O HP maximo que o simulador informa daqui em diante e o do nivel novo.
    const later = battle.takeTurn({ kind: 'move', index: 0 });
    const hpEvent = later.find((e) => (e.t === 'damage' || e.t === 'heal') && e.side === 'player');
    if (hpEvent && (hpEvent.t === 'damage' || hpEvent.t === 'heal')) expect(hpEvent.maxHp).toBe(maxHp(ctx, player));
  });

  it('nenhum texto deixa escapar o protocolo cru', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const battle = new Battle(
        ctx,
        chart,
        new RNG(seed),
        [make(25, 18), make(1, 18)],
        [make(74, 16), make(95, 17)],
        { kind: 'trainer', foeName: 'Brock', canRun: false },
      );
      const all = [...battle.start()];
      for (let i = 0; i < 40 && !battle.outcome; i++) {
        if (battle.awaitingSwitch) {
          all.push(...battle.switchTo(battle.player.party.findIndex((p) => p.hp > 0)));
          continue;
        }
        all.push(...battle.takeTurn({ kind: 'move', index: i % 2 }));
      }
      expect(battle.outcome).not.toBeNull();
      for (const text of texts(all)) {
        expect(text).not.toMatch(/\||p[12][ab]?:|\bm\d\b|undefined|\[object/);
      }
    }
  });
});

describe('leitor do protocolo', () => {
  function reader() {
    const party = [make(4, 10)];
    const foes = [make(16, 10)];
    return new ProtocolReader({
      kind: 'wild',
      resolve: (ident) => {
        const side = ident.startsWith('p1') ? 'player' : 'foe';
        const pokemon = side === 'player' ? party[0] : foes[0];
        return { side, index: 0, pokemon };
      },
      label: (side, pokemon) => (side === 'player' ? ctx.species[pokemon.species].n : `${ctx.species[pokemon.species].n} selvagem`),
      plain: (pokemon) => ctx.species[pokemon.species].n,
      moveName: (id) => ctx.moves[id]?.n ?? id,
      onSwitchIn: () => undefined,
      onFaint: () => [],
    });
  }

  it('critico e efetividade viram texto depois do dano, e o dano leva o HP do momento', () => {
    const r = reader();
    r.read(['|switch|p2a: m0|Pidgey, L10|30/30', '|switch|p1a: m0|Charmander, L10|28/28']);
    const events = r.read([
      '|move|p1a: m0|Ember|p2a: m0',
      '|-crit|p2a: m0',
      '|-supereffective|p2a: m0',
      '|split|p2',
      '|-damage|p2a: m0|12/30',
      '|-damage|p2a: m0|12/30',
    ]);
    expect(events.map((e) => e.t)).toEqual(['text', 'useMove', 'damage', 'text', 'text']);
    expect(events[2]).toMatchObject({ side: 'foe', amount: 18, hp: 12, maxHp: 30, crit: true, effectiveness: 'super' });
    expect(events[3]).toEqual({ t: 'text', text: 'Foi um acerto critico!' });
    expect(events[4]).toEqual({ t: 'text', text: 'Foi super eficaz!' });
  });

  it('veneno toca a animacao antes do dano e fala em portugues', () => {
    const r = reader();
    r.read(['|switch|p1a: m0|Charmander, L10|28/28 psn']);
    const events = r.read(['|-damage|p1a: m0|25/28 psn|[from] psn']);
    expect(events[0]).toEqual({ t: 'anim', side: 'player', anim: 'psn' });
    expect(events[1]).toMatchObject({ t: 'damage', amount: 3, cause: 'psn' });
    expect(events[2]).toEqual({ t: 'text', text: 'Charmander sofre com o veneno!' });
  });

  it('atributos com o artigo certo', () => {
    const r = reader();
    r.read(['|switch|p2a: m0|Pidgey, L10|30/30']);
    const events = r.read(['|-unboost|p2a: m0|def|1', '|-boost|p2a: m0|atk|2']);
    expect(events.filter((e) => e.t === 'text')).toEqual([
      { t: 'text', text: 'A Defesa de Pidgey selvagem caiu!' },
      { t: 'text', text: 'O Ataque de Pidgey selvagem subiu muito!' },
    ]);
  });
});

/** Copia rasa o bastante para reusar um Pokemon em varias batalhas. */
function clone(pokemon: Pokemon): Pokemon {
  return { ...pokemon, moves: pokemon.moves.map((m) => ({ ...m })) };
}

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
