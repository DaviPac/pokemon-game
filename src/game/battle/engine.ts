/**
 * Motor de batalha sobre o simulador do Pokemon Showdown (`@pkmn/sim`).
 *
 * As regras -- dano, precisao, habilidades, itens segurados, clima, os mais de
 * seiscentos golpes com todos os efeitos -- sao as do Showdown, o mesmo codigo
 * que roda as batalhas competitivas do site. O que o simulador nao conhece e
 * do jogo e continua aqui: a mochila, a Pokebola, a fuga, a IA do oponente e a
 * EXP no fim de cada nocaute.
 *
 * A interface nao mudou: cada acao devolve a fila de eventos do turno inteiro,
 * e a tela anima um por um. Os eventos saem do log do simulador, lido pelo
 * `ProtocolReader`.
 */
import { Battle as SimBattle, Dex, type Pokemon as SimPokemon } from '@pkmn/sim';
import type { RNG } from '../core/rng.js';
import type { MoveCategory, PokemonType, StatName, StatusName, TypeChart } from '../data/types.js';
import type { Pokemon, PokemonContext } from '../pokemon/pokemon.js';
import {
  displayName,
  evolutionAt,
  expGained,
  expForLevel,
  expProgress,
  isFainted,
  makeMoveSlot,
  maxHp,
  movesLearnedAt,
  speciesOf,
  statValue,
  MOVE_SLOTS,
  MAX_LEVEL,
} from '../pokemon/pokemon.js';
import { chooseFoeAction } from './ai.js';
import { attemptCapture, escapeChance, type CaptureContext } from './capture.js';
import { typeEffectiveness } from './effectiveness.js';
import { BATTLE_ITEMS } from './items.js';
import { ProtocolReader, type Resolved } from './protocol.js';
import type {
  BattleAction,
  BattleConfig,
  BattleEvent,
  BattleOutcome,
  BattleTeam,
  Side,
} from './types.js';

export { BATTLE_ITEMS } from './items.js';

/**
 * Geracao 6 (X/Y), a mesma dos dados do jogo: 721 especies, tipo Fada e as
 * regras de antes dos Z-Moves. Sem previa de times -- o primeiro saudavel
 * entra direto, como no jogo de verdade.
 */
const FORMAT = 'gen6customgame@@@!Team Preview';

/**
 * Uma condicao que so existe para o jogo: o Pokemon do jogador passa a vez em
 * silencio. E como a mochila, a bola e a fuga entram num turno do simulador --
 * o jogador "escolhe um golpe" que nunca acontece, e o oponente age normalmente.
 */
const SKIP_ID = 'pdskipturn';

const PLAYER_NAME = 'Jogador';
const FOE_NAME = 'Oponente';

const STAT_KEYS: StatName[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Uma opcao do menu de golpes, ja com o que o simulador permite. */
export interface MoveOption {
  /** Posicao para `takeTurn({ kind: 'move', index })`. */
  index: number;
  id: string;
  name: string;
  type: PokemonType;
  category: MoveCategory;
  pp: number;
  maxPp: number;
  disabled: boolean;
}

type SimSide = SimBattle['p1'];

export class Battle {
  readonly config: BattleConfig;
  readonly player: BattleTeam;
  readonly foe: BattleTeam;
  turn = 0;
  outcome: BattleOutcome | null = null;
  /** True quando o jogador precisa escolher um substituto antes de seguir. */
  awaitingSwitch = false;
  escapeAttempts = 0;
  caught: Pokemon | null = null;

  private readonly ctx: PokemonContext;
  private readonly chart: TypeChart;
  private readonly rng: RNG;
  private readonly sim: SimBattle;
  private readonly reader: ProtocolReader;
  /** Ate onde o log do simulador ja foi lido. */
  private cursor = 0;
  /** Quem esteve em campo: divide a EXP como nos jogos. */
  private participants = new Set<string>();

  constructor(
    ctx: PokemonContext,
    chart: TypeChart,
    rng: RNG,
    playerParty: Pokemon[],
    foeParty: Pokemon[],
    config: BattleConfig,
  ) {
    this.ctx = ctx;
    this.chart = chart;
    this.rng = rng;
    this.config = config;
    this.player = { party: playerParty, activeIndex: Math.max(0, firstHealthy(playerParty)) };
    this.foe = { party: foeParty, activeIndex: Math.max(0, firstHealthy(foeParty)) };

    this.sim = new SimBattle({
      formatid: FORMAT as never,
      seed: `${rng.int(0x10000)},${rng.int(0x10000)},${rng.int(0x10000)},${rng.int(0x10000)}`,
    });
    registerSkipCondition(this.sim);

    this.reader = new ProtocolReader({
      kind: config.kind,
      foeName: config.foeName,
      resolve: (ident) => this.resolve(ident),
      label: (side, pokemon) => this.label(side, pokemon),
      plain: (pokemon) => displayName(this.ctx, pokemon),
      moveName: (id) => this.ctx.moves[id]?.n ?? Dex.moves.get(id).name ?? id,
      onSwitchIn: (side, index) => {
        this.team(side).activeIndex = index;
        if (side === 'player') this.participants.add(this.player.party[index].uid);
      },
      onFaint: (side, index) => (side === 'foe' ? this.awardExp(this.foe.party[index]) : []),
    });

    // O simulador comeca a batalha sozinho assim que o segundo jogador entra.
    // O estado salvo (HP, status, PP) tem de estar no lugar antes disso, entao
    // a partida so e dada depois, a mao.
    this.sim.setPlayer('p1', { name: PLAYER_NAME, team: this.teamFor(playerParty, this.player.activeIndex) as never });
    this.sim.started = true;
    this.sim.setPlayer('p2', { name: FOE_NAME, team: this.teamFor(foeParty, this.foe.activeIndex) as never });
    this.sim.started = false;
    this.restore(this.sim.p1, playerParty);
    this.restore(this.sim.p2, foeParty);
    this.sim.start();
    // A largada reconta a equipe inteira como de pe; quem ja chegou desmaiado
    // nao conta.
    for (const side of [this.sim.p1, this.sim.p2]) {
      side.pokemonLeft = side.pokemon.filter((p) => !p.fainted).length;
    }
  }

  // --- Acesso ---------------------------------------------------------------

  team(side: Side): BattleTeam {
    return side === 'player' ? this.player : this.foe;
  }

  active(side: Side): Pokemon {
    const team = this.team(side);
    return team.party[team.activeIndex];
  }

  other(side: Side): Side {
    return side === 'player' ? 'foe' : 'player';
  }

  /** O Pokemon do simulador que corresponde a uma posicao da equipe do jogo. */
  private simPokemon(side: Side, index: number): SimPokemon | undefined {
    const simSide = side === 'player' ? this.sim.p1 : this.sim.p2;
    return simSide.pokemon.find((p) => p.m.index === index);
  }

  private simActive(side: Side): SimPokemon | undefined {
    return (side === 'player' ? this.sim.p1 : this.sim.p2).active[0];
  }

  /** O pedido que o simulador fez ao jogador neste turno. */
  private request(): {
    moves: { id: string; move: string; pp?: number; maxpp?: number; disabled?: boolean | string }[];
    trapped: boolean;
  } | null {
    const request = this.sim.p1.activeRequest as
      | { active?: { moves: never[]; trapped?: boolean; maybeTrapped?: boolean }[] }
      | null;
    const active = request?.active?.[0];
    if (!active) return null;
    return { moves: active.moves, trapped: Boolean(active.trapped) };
  }

  /**
   * Os golpes que o jogador pode escolher agora. Vem do simulador: ele sabe
   * quando um golpe foi desativado, quando so resta Struggle ou quando o
   * Pokemon esta preso num golpe de varios turnos.
   */
  moveOptions(): MoveOption[] {
    const request = this.request();
    const own = this.active('player');
    if (!request) {
      return own.moves.map((slot, index) => this.option(index, slot.id, slot.pp, slot.maxPp, slot.pp <= 0));
    }
    return request.moves.map((move, index) =>
      this.option(
        index,
        move.id,
        move.pp ?? own.moves[index]?.pp ?? 0,
        move.maxpp ?? own.moves[index]?.maxPp ?? 0,
        Boolean(move.disabled),
        move.move,
      ),
    );
  }

  private option(index: number, id: string, pp: number, maxPp: number, disabled: boolean, name?: string): MoveOption {
    const data = this.ctx.moves[id];
    const dex = Dex.moves.get(id);
    return {
      index,
      id,
      name: data?.n ?? name ?? dex.name,
      type: (data?.t ?? dex.type ?? 'Normal') as PokemonType,
      category: (data?.cat ?? dex.category ?? 'Physical') as MoveCategory,
      pp,
      maxPp,
      disabled,
    };
  }

  /**
   * Preso num golpe de varios turnos (Outrage, Solar Beam carregando, Rollout):
   * o turno segue sozinho, sem mochila nem troca.
   */
  get locked(): boolean {
    const request = this.request();
    if (!request) return false;
    const pokemon = this.simActive('player');
    return Boolean(pokemon?.getLockedMove());
  }

  /** Mean Look, Wrap, Shadow Tag... impedem a troca e a fuga. */
  get trapped(): boolean {
    return this.request()?.trapped ?? false;
  }

  // --- Montagem -------------------------------------------------------------

  /** Converte a equipe do jogo para o formato de time do Showdown. */
  private teamFor(party: Pokemon[], lead: number) {
    const order = [lead, ...party.map((_, i) => i).filter((i) => i !== lead)];
    return order.map((index) => {
      const pokemon = party[index];
      const species = speciesOf(this.ctx, pokemon);
      const spread = (values: number[]) =>
        Object.fromEntries(STAT_KEYS.map((stat, i) => [stat, values[i] ?? 0]));
      return {
        // O nome carrega a posicao na equipe do jogo: o simulador reordena a
        // equipe a cada troca, e o log so cita o Pokemon pelo nome.
        name: `m${index}`,
        species: species.n,
        level: pokemon.level,
        gender: pokemon.gender === 'N' ? 'N' : pokemon.gender,
        shiny: pokemon.shiny,
        ability: pokemon.ability || species.ab[0] || '',
        item: pokemon.heldItem ?? '',
        nature: pokemon.nature,
        ivs: spread(pokemon.ivs),
        evs: spread(pokemon.evs),
        happiness: pokemon.friendship,
        moves: pokemon.moves.map((slot) => slot.id),
      };
    });
  }

  /** Poe HP, status e PP do save nos Pokemon do simulador. */
  private restore(side: SimSide, party: Pokemon[]): void {
    for (const simPokemon of side.pokemon) {
      const index = Number(simPokemon.name.slice(1));
      simPokemon.m.index = index;
      const pokemon = party[index];

      simPokemon.moveSlots.forEach((slot, i) => {
        const own = pokemon.moves[i];
        if (!own) return;
        slot.pp = own.pp;
        slot.maxpp = own.maxPp;
      });

      if (pokemon.hp <= 0) {
        simPokemon.hp = 0;
        simPokemon.fainted = true;
        simPokemon.status = 'fnt' as never;
        continue;
      }
      simPokemon.hp = Math.min(pokemon.hp, simPokemon.maxhp);
      if (pokemon.status) {
        simPokemon.status = pokemon.status as never;
        simPokemon.statusState.id = pokemon.status;
        simPokemon.statusState.target = simPokemon;
        if (pokemon.status === 'slp') {
          // O simulador conta o sono do jeito dele: turnos restantes + 1.
          const turns = Math.max(1, pokemon.sleepTurns + 1);
          simPokemon.statusState.startTime = turns;
          simPokemon.statusState.time = turns;
        }
        if (pokemon.status === 'tox') simPokemon.statusState.stage = 0;
      }
    }
  }

  /** Copia o estado do simulador de volta para a equipe do jogo. */
  private sync(): void {
    for (const [side, party] of [
      [this.sim.p1, this.player.party],
      [this.sim.p2, this.foe.party],
    ] as const) {
      for (const simPokemon of side.pokemon) {
        const pokemon = party[simPokemon.m.index as number];
        if (!pokemon) continue;
        pokemon.hp = Math.max(0, simPokemon.hp);
        const status = simPokemon.status as string;
        pokemon.status = status && status !== 'fnt' ? (status as StatusName) : null;
        pokemon.sleepTurns = pokemon.status === 'slp' ? Math.max(0, (simPokemon.statusState.time ?? 1) - 1) : 0;
        // Os golpes de verdade, nao os copiados por Transform ou Mimic.
        simPokemon.baseMoveSlots.forEach((slot, i) => {
          const own = pokemon.moves[i];
          if (own && own.id === slot.id) own.pp = Math.max(0, Math.min(own.maxPp, slot.pp));
        });
        if (pokemon.heldItem && !simPokemon.item) pokemon.heldItem = null;
      }
    }
  }

  // --- Leitura --------------------------------------------------------------

  private resolve(ident: string): Resolved | null {
    const match = /^p([12])[a-z]?:\s*m(\d+)/.exec(ident);
    if (!match) return null;
    const side: Side = match[1] === '1' ? 'player' : 'foe';
    const index = Number(match[2]);
    const pokemon = this.team(side).party[index];
    return pokemon ? { side, index, pokemon } : null;
  }

  private label(side: Side, pokemon: Pokemon): string {
    const name = displayName(this.ctx, pokemon);
    if (side === 'player') return name;
    return this.config.kind === 'wild' ? `${name} selvagem` : `${name} adversario`;
  }

  /** Le o que o simulador escreveu desde a ultima vez. */
  private drainLog(): BattleEvent[] {
    const lines = this.sim.log.slice(this.cursor);
    this.cursor = this.sim.log.length;
    return this.reader.read(lines);
  }

  // --- Abertura -------------------------------------------------------------

  /** Abertura do combate: quem entra em campo e o texto inicial. */
  start(): BattleEvent[] {
    const events = this.drainLog();
    // O simulador manda o jogador a campo primeiro; os jogos mostram o
    // oponente antes, e so depois o "Vai, Fulano!". Cada entrada e o texto
    // seguido do evento de entrada.
    const entry = (side: Side): BattleEvent[] => {
      const at = events.findIndex((e) => e.t === 'sendOut' && e.side === side);
      if (at < 0) return [];
      const from = at > 0 && events[at - 1].t === 'text' ? at - 1 : at;
      return events.slice(from, at + 1);
    };
    const foe = entry('foe');
    const player = entry('player');
    const rest = events.filter((e) => !foe.includes(e) && !player.includes(e));
    const ordered: BattleEvent[] = [...foe, ...player, ...rest];
    if (this.config.kind === 'trainer') {
      ordered.unshift({ t: 'text', text: `${this.config.foeName ?? 'O treinador'} quer batalhar!` });
    }
    this.sync();
    return ordered;
  }

  // --- Turno ----------------------------------------------------------------

  takeTurn(action: BattleAction): BattleEvent[] {
    if (this.outcome || this.awaitingSwitch) return [];
    this.turn++;
    const events: BattleEvent[] = [];

    switch (action.kind) {
      case 'run':
        if (!this.tryRun(events)) return events;
        break;
      case 'item':
        if (!this.useItem(action.item, action.targetIndex, events)) return events;
        break;
      case 'switch': {
        const target = this.simPokemon('player', action.index);
        const choice = target ? `switch ${this.sim.p1.pokemon.indexOf(target) + 1}` : 'default';
        if (!this.sim.choose('p1', choice)) this.sim.choose('p1', 'default');
        break;
      }
      case 'move':
        if (!this.sim.choose('p1', `move ${action.index + 1}`)) this.sim.choose('p1', 'default');
        break;
    }

    return [...events, ...this.resolveTurn()];
  }

  /** Jogar uma bola: acao unica do turno numa batalha selvagem. */
  throwBall(
    ballId: string,
    context: Omit<CaptureContext, 'target' | 'targetLevel' | 'turn' | 'isFirstTurn'>,
  ): BattleEvent[] {
    if (this.outcome || this.awaitingSwitch) return [];
    if (this.config.kind !== 'wild') {
      return [{ t: 'text', text: 'Nao da para capturar o Pokemon de outro treinador!' }];
    }
    this.turn++;
    this.sync();
    const target = this.active('foe');
    const result = attemptCapture(this.ctx, this.rng, ballId, target, {
      ...context,
      target,
      targetLevel: target.level,
      turn: this.turn,
      isFirstTurn: this.turn === 1,
    });

    const events: BattleEvent[] = [{ t: 'ball', shakes: result.shakes, caught: result.caught, ball: ballId }];
    if (result.caught) {
      events.push({ t: 'text', text: `${displayName(this.ctx, target)} foi capturado!` });
      events.push({ t: 'caught', species: target.species });
      this.caught = target;
      this.finish('caught', events);
      return events;
    }

    events.push({
      t: 'text',
      text:
        result.shakes === 0
          ? 'Ah! O Pokemon escapou na hora!'
          : result.shakes < 3
            ? 'Faltou pouco!'
            : 'Quase! Ele escapou no ultimo instante!',
    });
    // O selvagem ainda ataca no mesmo turno.
    this.skipPlayer();
    return [...events, ...this.resolveTurn()];
  }

  /** Troca forcada depois de um nocaute (ou de U-turn, Baton Pass...). */
  switchTo(index: number): BattleEvent[] {
    if (!this.awaitingSwitch) return [];
    const pokemon = this.player.party[index];
    if (!pokemon || isFainted(pokemon)) return [];
    const target = this.simPokemon('player', index);
    if (!target || !this.sim.choose('p1', `switch ${this.sim.p1.pokemon.indexOf(target) + 1}`)) return [];
    this.awaitingSwitch = false;
    return this.resolveTurn();
  }

  /** O jogador passa a vez: a mochila, a bola ou a fuga ja foram o turno dele. */
  private skipPlayer(): void {
    const pokemon = this.simActive('player');
    if (pokemon && !pokemon.fainted) pokemon.addVolatile(SKIP_ID);
    if (!this.sim.choose('p1', 'move 1')) this.sim.choose('p1', 'default');
  }

  /**
   * Faz o oponente escolher e le o turno. Um nocaute no meio pede trocas; a
   * do oponente e resolvida aqui, a do jogador para e espera a tela.
   */
  private resolveTurn(): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (let guard = 0; guard < 12; guard++) {
      if (this.sim.p2.requestState && !this.sim.p2.isChoiceDone()) this.chooseForFoe();
      events.push(...this.drainLog());
      this.sync();

      if (this.sim.ended) {
        this.finish(this.sim.winner === PLAYER_NAME ? 'win' : 'loss', events);
        return events;
      }
      if (this.sim.p1.requestState === 'switch' && !this.sim.p1.isChoiceDone()) {
        // O oponente pode ter de trocar no mesmo instante: escolhe ja, para o
        // simulador so esperar pelo jogador.
        if (this.sim.p2.requestState === 'switch' && !this.sim.p2.isChoiceDone()) this.chooseForFoe();
        this.awaitingSwitch = true;
        events.push({ t: 'prompt', kind: 'chooseSwitch' });
        return events;
      }
      if (this.sim.p2.requestState === 'switch' && !this.sim.p2.isChoiceDone()) continue;
      break;
    }
    return events;
  }

  private chooseForFoe(): void {
    const side = this.sim.p2;
    if (side.requestState === 'switch') {
      // Nocaute: entra o proximo saudavel, na ordem da equipe.
      const next = this.foe.party.findIndex(
        (p, i) => i !== this.foe.activeIndex && !isFainted(p) && !this.simPokemon('foe', i)?.fainted,
      );
      const target = next >= 0 ? this.simPokemon('foe', next) : undefined;
      if (!target || !this.sim.choose('p2', `switch ${side.pokemon.indexOf(target) + 1}`)) {
        this.sim.choose('p2', 'default');
      }
      return;
    }

    const action = chooseFoeAction(this.ctx, this.rng, this);
    let choice = 'default';
    if (action.kind === 'switch') {
      const target = this.simPokemon('foe', action.index);
      if (target) choice = `switch ${side.pokemon.indexOf(target) + 1}`;
    } else if (action.kind === 'move') {
      choice = `move ${action.index + 1}`;
    }
    if (!this.sim.choose('p2', choice)) this.sim.choose('p2', 'default');
  }

  private foeRequest() {
    return this.sim.p2.activeRequest as {
      active?: { moves: { disabled?: boolean | string; pp?: number }[]; trapped?: boolean }[];
    } | null;
  }

  /** Golpes que o oponente pode usar agora, segundo o simulador. */
  foeMoveUsable(index: number): boolean {
    const move = this.foeRequest()?.active?.[0]?.moves[index];
    if (!move) return false;
    return !move.disabled && (move.pp === undefined || move.pp > 0);
  }

  /** O oponente esta preso e nao pode trocar. */
  get foeTrapped(): boolean {
    return Boolean(this.foeRequest()?.active?.[0]?.trapped);
  }

  // --- Acoes do jogo --------------------------------------------------------

  /** Devolve true se o turno segue (a fuga falhou e o oponente age). */
  private tryRun(events: BattleEvent[]): boolean {
    if (!this.config.canRun || this.config.kind === 'trainer') {
      this.turn--;
      events.push({
        t: 'text',
        text:
          this.config.kind === 'trainer'
            ? 'Nao da para fugir de uma batalha de treinador!'
            : 'Nao da para fugir desta batalha!',
      });
      return false;
    }

    const own = this.simActive('player');
    const foe = this.simActive('foe');
    const ghost = own?.hasType('Ghost') ?? false;
    const runAway = own?.hasAbility('runaway') ?? false;
    if (this.trapped && !ghost && !runAway) {
      this.turn--;
      events.push({ t: 'text', text: 'Nao da para fugir!' });
      return false;
    }

    this.escapeAttempts++;
    const playerSpeed = own?.getStat('spe') ?? 1;
    const foeSpeed = foe?.getStat('spe') ?? 1;
    if (ghost || runAway || this.rng.next() < escapeChance(playerSpeed, foeSpeed, this.escapeAttempts)) {
      events.push({ t: 'text', text: 'Voce escapou em seguranca.' });
      this.finish('fled', events);
      return false;
    }
    events.push({ t: 'text', text: 'Nao deu para escapar!' });
    this.skipPlayer();
    return true;
  }

  /** Devolve true se o item foi usado (e o oponente age em seguida). */
  private useItem(itemId: string, targetIndex: number | undefined, events: BattleEvent[]): boolean {
    const item = BATTLE_ITEMS[itemId];
    const index = targetIndex ?? this.player.activeIndex;
    const target = this.player.party[index];
    const simTarget = this.simPokemon('player', index);
    if (!item || !target || !simTarget) return false;
    const isActive = index === this.player.activeIndex;
    const name = displayName(this.ctx, target);
    const max = simTarget.maxhp;
    let used = false;

    events.push({ t: 'text', text: `Voce usou ${item.name}.` });

    if (item.revive) {
      if (simTarget.fainted || simTarget.hp <= 0) {
        simTarget.fainted = false;
        simTarget.faintQueued = false;
        simTarget.status = '' as never;
        simTarget.hp = Math.floor(max / 2);
        this.sim.p1.pokemonLeft++;
        this.reader.setHealth('player', index, simTarget.hp, max);
        events.push({ t: 'text', text: `${name} voltou a si!` });
        used = true;
      }
    } else if (!simTarget.fainted && simTarget.hp > 0) {
      if (item.heal && simTarget.hp < max) {
        const healed = Math.min(item.heal, max - simTarget.hp);
        simTarget.hp += healed;
        this.reader.setHealth('player', index, simTarget.hp, max);
        if (isActive) events.push({ t: 'heal', side: 'player', amount: healed, hp: simTarget.hp, maxHp: max });
        events.push({ t: 'text', text: `${name} recuperou ${healed} de HP.` });
        used = true;
      }
      const status = simTarget.status as string;
      if (item.cure && status && (item.cure === 'all' || item.cure === status || (item.cure === 'psn' && status === 'tox'))) {
        simTarget.clearStatus();
        if (isActive) events.push({ t: 'status', side: 'player', status: null });
        events.push({ t: 'text', text: `${name} se recuperou.` });
        used = true;
      }
    }

    if (!used) events.push({ t: 'text', text: 'Mas nao teve efeito...' });
    this.skipPlayer();
    return true;
  }

  // --- EXP ------------------------------------------------------------------

  private awardExp(defeated: Pokemon): BattleEvent[] {
    const events: BattleEvent[] = [];
    const participants = this.player.party.filter((p, index) => {
      if (!this.participants.has(p.uid)) return false;
      const health = this.reader.healthOf('player', index);
      return (health ? health.hp : p.hp) > 0;
    });
    if (participants.length === 0) return events;

    for (const pokemon of participants) {
      if (pokemon.level >= MAX_LEVEL) continue;
      const index = this.player.party.indexOf(pokemon);
      const gained = expGained(this.ctx, defeated, pokemon.level, {
        trainerBattle: this.config.kind === 'trainer',
        participants: participants.length,
      });
      pokemon.exp += gained;

      const growth = speciesOf(this.ctx, pokemon).growth;
      const tracked = this.reader.healthOf('player', index);
      let hp = tracked?.hp ?? pokemon.hp;
      let leveledUp = false;
      while (pokemon.level < MAX_LEVEL && pokemon.exp >= expForLevel(growth, pokemon.level + 1)) {
        const beforeMax = maxHp(this.ctx, pokemon);
        pokemon.level++;
        leveledUp = true;
        // Subir de nivel aumenta o HP maximo e o atual junto.
        hp += maxHp(this.ctx, pokemon) - beforeMax;
        events.push({ t: 'text', text: `${displayName(this.ctx, pokemon)} subiu para o nivel ${pokemon.level}!` });

        for (const moveId of movesLearnedAt(this.ctx, pokemon.species, pokemon.level)) {
          if (pokemon.moves.some((m) => m.id === moveId)) continue;
          if (pokemon.moves.length < MOVE_SLOTS) {
            pokemon.moves.push(makeMoveSlot(this.ctx, moveId));
            this.learnInSim(index, moveId);
            events.push({ t: 'learnMove', uid: pokemon.uid, move: moveId });
            events.push({
              t: 'text',
              text: `${displayName(this.ctx, pokemon)} aprendeu ${this.ctx.moves[moveId]?.n ?? moveId}!`,
            });
          }
        }

        const evolution = evolutionAt(this.ctx, pokemon);
        if (evolution !== null) {
          events.push({ t: 'evolve', uid: pokemon.uid, from: pokemon.species, to: evolution });
        }
      }

      if (leveledUp) this.levelUpInSim(index, pokemon);
      const max = maxHp(this.ctx, pokemon);
      if (leveledUp) this.reader.setHealth('player', index, hp, max);

      events.push({
        t: 'exp',
        uid: pokemon.uid,
        gained,
        level: pokemon.level,
        leveledUp,
        progress: expProgress(this.ctx, pokemon),
        hp,
        maxHp: max,
      });
    }

    // Distribuicao de EVs de quem participou.
    const yields = speciesOf(this.ctx, defeated).ev;
    for (const pokemon of participants) {
      const total = pokemon.evs.reduce((a, b) => a + b, 0);
      for (let i = 0; i < 6 && total < 510; i++) {
        pokemon.evs[i] = Math.min(252, pokemon.evs[i] + (yields[i] ?? 0));
      }
    }
    return events;
  }

  /** O Pokemon do simulador sobe junto: nivel, atributos e HP maximo. */
  private levelUpInSim(index: number, pokemon: Pokemon): void {
    const simPokemon = this.simPokemon('player', index);
    if (!simPokemon) return;
    (simPokemon as { level: number }).level = pokemon.level;
    simPokemon.set.level = pokemon.level;
    const stats = this.sim.spreadModify(simPokemon.species.baseStats, simPokemon.set);
    simPokemon.baseStoredStats = stats;
    if (!simPokemon.transformed) {
      for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) simPokemon.storedStats[stat] = stats[stat];
    }
    const newMax = statValue(this.ctx, pokemon, 'hp');
    const gained = newMax - simPokemon.maxhp;
    simPokemon.baseMaxhp = newMax;
    simPokemon.maxhp = newMax;
    if (simPokemon.hp > 0) simPokemon.hp = Math.min(newMax, simPokemon.hp + gained);
  }

  private learnInSim(index: number, moveId: string): void {
    const simPokemon = this.simPokemon('player', index);
    const move = Dex.moves.get(moveId);
    if (!simPokemon || !move.exists) return;
    const slot = makeMoveSlot(this.ctx, moveId);
    const entry = {
      move: move.name,
      id: move.id,
      pp: slot.pp,
      maxpp: slot.maxPp,
      target: move.target,
      disabled: false,
      used: false,
    };
    simPokemon.baseMoveSlots.push(entry);
    if (!simPokemon.transformed) simPokemon.moveSlots.push(entry);
    simPokemon.set.moves.push(move.name);
  }

  private finish(outcome: BattleOutcome, events: BattleEvent[]): void {
    this.outcome = outcome;
    this.awaitingSwitch = false;
    events.push({ t: 'end', outcome });
  }

  // --- IA -------------------------------------------------------------------

  /** Usado pela IA: quanto este golpe machucaria o alvo. */
  estimateDamage(side: Side, moveId: string): number {
    const move = this.ctx.moves[moveId];
    if (!move || move.cat === 'Status') return 0;
    const attacker = this.active(side);
    const defender = this.active(this.other(side));
    const effectiveness = typeEffectiveness(this.chart, move.t, speciesOf(this.ctx, defender).t);
    if (effectiveness === 0) return 0;

    const physical = move.cat === 'Physical';
    const attack = statValue(this.ctx, attacker, physical ? 'atk' : 'spa');
    const defense = statValue(this.ctx, defender, physical ? 'def' : 'spd');
    const base =
      Math.floor(
        Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * move.bp * attack) / defense) / 50,
      ) + 2;
    const stab = speciesOf(this.ctx, attacker).t.includes(move.t) ? 1.5 : 1;
    return base * stab * effectiveness * ((move.acc ?? 100) / 100);
  }
}

/**
 * Registra a condicao de "passar a vez" nos dados do simulador. Ela trava a
 * escolha no golpe vazio de recarga e cancela a acao antes de qualquer
 * mensagem, entao o log nao mostra nada.
 */
function registerSkipCondition(sim: SimBattle): void {
  const conditions = sim.dex.data.Conditions as Record<string, unknown>;
  if (conditions[SKIP_ID]) return;
  conditions[SKIP_ID] = {
    // O simulador tira o id do nome: os dois precisam bater.
    name: 'PD Skip Turn',
    onBeforeMovePriority: 200,
    onBeforeMove(this: unknown, pokemon: SimPokemon) {
      pokemon.removeVolatile(SKIP_ID);
      return null;
    },
    onLockMove: 'recharge',
  };
}

export function firstHealthy(party: Pokemon[]): number {
  return party.findIndex((p) => !isFainted(p));
}
