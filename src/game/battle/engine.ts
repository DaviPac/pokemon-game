/**
 * Motor de batalha. E TypeScript puro: nao toca no DOM e nao sorteia nada fora
 * do RNG semeado, entao da para testar turno a turno.
 *
 * A saida e uma fila de eventos (`BattleEvent`) que a interface consome para
 * animar. O motor nunca espera pela animacao -- ele resolve o turno inteiro de
 * uma vez e entrega o roteiro.
 */
import type { RNG } from '../core/rng.js';
import type { MoveData, StatName, StatusName, TypeChart } from '../data/types.js';
import type { Pokemon, PokemonContext } from '../pokemon/pokemon.js';
import {
  displayName,
  evolutionAt,
  expGained,
  expForLevel,
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
import {
  accuracyCheck,
  calculateDamage,
  clampStage,
  confusionDamage,
  describeEffectiveness,
  effectiveStat,
  typeEffectiveness,
} from './damage.js';
import {
  freshActiveState,
  type ActiveState,
  type BattleAction,
  type BattleConfig,
  type BattleEvent,
  type BattleOutcome,
  type BattleTeam,
  type Side,
} from './types.js';

const STATUS_LABEL: Record<StatusName, string> = {
  brn: 'foi queimado',
  par: 'ficou paralisado',
  slp: 'caiu no sono',
  frz: 'foi congelado',
  psn: 'foi envenenado',
  tox: 'foi gravemente envenenado',
};

const STAT_LABEL: Record<string, string> = {
  atk: 'Ataque',
  def: 'Defesa',
  spa: 'Ataque Especial',
  spd: 'Defesa Especial',
  spe: 'Velocidade',
  accuracy: 'Precisao',
  evasion: 'Evasao',
};

export interface BattleItemUse {
  /** Cura fixa de HP. */
  heal?: number;
  /** Remove status; 'all' limpa qualquer um. */
  cure?: StatusName | 'all';
  /** Revive com metade do HP. */
  revive?: boolean;
  ball?: string;
}

export const BATTLE_ITEMS: Record<string, BattleItemUse & { name: string }> = {
  potion: { name: 'Potion', heal: 20 },
  superpotion: { name: 'Super Potion', heal: 60 },
  hyperpotion: { name: 'Hyper Potion', heal: 120 },
  maxpotion: { name: 'Max Potion', heal: 9999 },
  fullheal: { name: 'Full Heal', cure: 'all' },
  antidote: { name: 'Antidote', cure: 'psn' },
  awakening: { name: 'Awakening', cure: 'slp' },
  paralyzeheal: { name: 'Paralyze Heal', cure: 'par' },
  revive: { name: 'Revive', revive: true },
};

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
  private events: BattleEvent[] = [];
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
    this.player = { party: playerParty, activeIndex: firstHealthy(playerParty), state: freshActiveState() };
    this.foe = { party: foeParty, activeIndex: firstHealthy(foeParty), state: freshActiveState() };
    this.participants.add(this.active('player').uid);
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

  /** Devolve e limpa os eventos acumulados. */
  drain(): BattleEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Abertura do combate: quem entra em campo e o texto inicial. */
  start(): BattleEvent[] {
    const foe = this.active('foe');
    if (this.config.kind === 'wild') {
      this.text(`Um ${displayName(this.ctx, foe)} selvagem apareceu!`);
    } else {
      this.text(`${this.config.foeName ?? 'Treinador'} quer batalhar!`);
      this.push({ t: 'sendOut', side: 'foe', index: this.foe.activeIndex });
      this.text(`${this.config.foeName ?? 'Treinador'} enviou ${displayName(this.ctx, foe)}!`);
    }
    this.push({ t: 'sendOut', side: 'player', index: this.player.activeIndex });
    this.text(`Vai, ${displayName(this.ctx, this.active('player'))}!`);
    this.onSendOut('foe');
    this.onSendOut('player');
    return this.drain();
  }

  // --- Turno ----------------------------------------------------------------

  takeTurn(action: BattleAction): BattleEvent[] {
    if (this.outcome) return this.drain();
    this.turn++;

    // Fugir e capturar terminam o turno na hora.
    if (action.kind === 'run') {
      this.resolveRun();
      return this.drain();
    }
    if (action.kind === 'item' && BATTLE_ITEMS[action.item]?.ball !== undefined) {
      // (bolas chegam por throwBall; aqui so por seguranca)
      return this.drain();
    }

    const foeAction = chooseFoeAction(this.ctx, this.chart, this.rng, this);

    const order = this.decideOrder(action, foeAction);
    for (const [side, chosen] of order) {
      if (this.outcome) break;
      if (isFainted(this.active(side))) continue;
      this.performAction(side, chosen);
      this.checkFaints();
      if (this.awaitingSwitch || this.outcome) break;
    }

    if (!this.outcome && !this.awaitingSwitch) this.endOfTurn();
    return this.drain();
  }

  /** Jogar uma bola: acao unica do turno numa batalha selvagem. */
  throwBall(ballId: string, context: Omit<CaptureContext, 'target' | 'targetLevel' | 'turn' | 'isFirstTurn'>): BattleEvent[] {
    if (this.config.kind !== 'wild') {
      this.text('Nao da para capturar o Pokemon de outro treinador!');
      return this.drain();
    }
    this.turn++;
    const target = this.active('foe');
    const result = attemptCapture(this.ctx, this.rng, ballId, target, {
      ...context,
      target,
      targetLevel: target.level,
      turn: this.turn,
      isFirstTurn: this.turn === 1,
    });

    this.push({ t: 'ball', shakes: result.shakes, caught: result.caught, ball: ballId });
    if (result.caught) {
      this.text(`${displayName(this.ctx, target)} foi capturado!`);
      this.push({ t: 'caught', species: target.species });
      this.caught = target;
      this.finish('caught');
      return this.drain();
    }

    this.text(
      result.shakes === 0
        ? 'Ah! O Pokemon escapou na hora!'
        : result.shakes < 3
          ? 'Faltou pouco!'
          : 'Quase! Ele escapou no ultimo instante!',
    );

    // O selvagem ainda ataca no mesmo turno.
    const foeAction = chooseFoeAction(this.ctx, this.chart, this.rng, this);
    this.performAction('foe', foeAction);
    this.checkFaints();
    if (!this.outcome && !this.awaitingSwitch) this.endOfTurn();
    return this.drain();
  }

  /** Troca forcada depois de um nocaute. */
  switchTo(index: number): BattleEvent[] {
    const team = this.player;
    if (index < 0 || index >= team.party.length) return this.drain();
    if (isFainted(team.party[index])) return this.drain();

    team.activeIndex = index;
    team.state = freshActiveState();
    this.participants.add(team.party[index].uid);
    this.push({ t: 'sendOut', side: 'player', index });
    this.text(`Vai, ${displayName(this.ctx, team.party[index])}!`);
    this.onSendOut('player');
    this.awaitingSwitch = false;
    return this.drain();
  }

  // --- Resolucao ------------------------------------------------------------

  private decideOrder(
    playerAction: BattleAction,
    foeAction: BattleAction,
  ): [Side, BattleAction][] {
    const priorityOf = (side: Side, action: BattleAction): number => {
      if (action.kind === 'switch' || action.kind === 'item' || action.kind === 'run') return 6;
      const move = this.moveOf(side, action.index);
      return move?.pri ?? 0;
    };

    const playerPriority = priorityOf('player', playerAction);
    const foePriority = priorityOf('foe', foeAction);
    if (playerPriority !== foePriority) {
      return playerPriority > foePriority
        ? [
            ['player', playerAction],
            ['foe', foeAction],
          ]
        : [
            ['foe', foeAction],
            ['player', playerAction],
          ];
    }

    const playerSpeed = effectiveStat(this.ctx, this.active('player'), this.player.state, 'spe');
    const foeSpeed = effectiveStat(this.ctx, this.active('foe'), this.foe.state, 'spe');
    const playerFirst = playerSpeed === foeSpeed ? this.rng.chance(0.5) : playerSpeed > foeSpeed;
    return playerFirst
      ? [
          ['player', playerAction],
          ['foe', foeAction],
        ]
      : [
          ['foe', foeAction],
          ['player', playerAction],
        ];
  }

  private performAction(side: Side, action: BattleAction): void {
    switch (action.kind) {
      case 'move':
        this.useMove(side, action.index);
        break;
      case 'switch':
        this.doSwitch(side, action.index);
        break;
      case 'item':
        this.useItem(side, action.item, action.targetIndex);
        break;
      case 'run':
        this.resolveRun();
        break;
    }
  }

  private doSwitch(side: Side, index: number): void {
    const team = this.team(side);
    if (index === team.activeIndex || isFainted(team.party[index])) return;
    this.text(`Volte, ${displayName(this.ctx, this.active(side))}!`);
    team.activeIndex = index;
    team.state = freshActiveState();
    this.participants.add(team.party[index].uid);
    this.push({ t: 'sendOut', side, index });
    this.text(`Vai, ${displayName(this.ctx, team.party[index])}!`);
    this.onSendOut(side);
  }

  private useItem(side: Side, itemId: string, targetIndex?: number): void {
    const item = BATTLE_ITEMS[itemId];
    if (!item) return;
    const team = this.team(side);
    const target = team.party[targetIndex ?? team.activeIndex];
    if (!target) return;

    if (item.revive) {
      if (!isFainted(target)) return;
      target.hp = Math.floor(maxHp(this.ctx, target) / 2);
      this.text(`${displayName(this.ctx, target)} voltou a si!`);
      this.push({ t: 'heal', side, amount: target.hp, hp: target.hp, maxHp: maxHp(this.ctx, target) });
      return;
    }

    if (item.heal) {
      const max = maxHp(this.ctx, target);
      const healed = Math.min(item.heal, max - target.hp);
      target.hp += healed;
      this.text(`${displayName(this.ctx, target)} recuperou ${healed} de HP.`);
      this.push({ t: 'heal', side, amount: healed, hp: target.hp, maxHp: max });
    }

    if (item.cure && target.status && (item.cure === 'all' || item.cure === target.status)) {
      target.status = null;
      target.sleepTurns = 0;
      this.push({ t: 'status', side, status: null });
      this.text(`${displayName(this.ctx, target)} se recuperou.`);
    }
  }

  private resolveRun(): void {
    if (!this.config.canRun) {
      this.text('Nao da para fugir desta batalha!');
      return;
    }
    if (this.config.kind === 'trainer') {
      this.text('Nao da para fugir de uma batalha de treinador!');
      return;
    }
    this.escapeAttempts++;
    const playerSpeed = effectiveStat(this.ctx, this.active('player'), this.player.state, 'spe');
    const foeSpeed = effectiveStat(this.ctx, this.active('foe'), this.foe.state, 'spe');
    if (this.rng.next() < escapeChance(playerSpeed, foeSpeed, this.escapeAttempts)) {
      this.text('Voce escapou em seguranca.');
      this.finish('fled');
    } else {
      this.text('Nao deu para escapar!');
      const foeAction = chooseFoeAction(this.ctx, this.chart, this.rng, this);
      this.performAction('foe', foeAction);
      this.checkFaints();
      if (!this.outcome && !this.awaitingSwitch) this.endOfTurn();
    }
  }

  private moveOf(side: Side, index: number): MoveData | null {
    const slot = this.active(side).moves[index];
    return slot ? (this.ctx.moves[slot.id] ?? null) : null;
  }

  private useMove(side: Side, index: number): void {
    const attacker = this.active(side);
    const defenderSide = this.other(side);
    const defender = this.active(defenderSide);
    const state = this.team(side).state;
    const defenderState = this.team(defenderSide).state;
    const slot = attacker.moves[index];
    const move = slot ? this.ctx.moves[slot.id] : undefined;

    if (!slot || !move) {
      this.struggle(side);
      return;
    }
    if (slot.pp <= 0) {
      this.struggle(side);
      return;
    }

    if (!this.canAct(side)) return;

    slot.pp--;
    state.lastMove = slot.id;
    this.push({ t: 'useMove', side, move: slot.id });
    this.text(`${displayName(this.ctx, attacker)} usou ${move.n}!`);

    // Protect e o unico "estado de barreira" que implementamos.
    if (move.volatile === 'protect' && move.target === 'self') {
      const odds = 1 / 2 ** state.consecutiveProtect;
      if (this.rng.next() < odds) {
        state.protected = true;
        state.consecutiveProtect++;
        this.text(`${displayName(this.ctx, attacker)} se protegeu!`);
      } else {
        state.consecutiveProtect = 0;
        this.text('Mas falhou!');
      }
      return;
    }
    state.consecutiveProtect = 0;

    if (defenderState.protected && move.protect) {
      this.text(`${displayName(this.ctx, defender)} se protegeu!`);
      return;
    }

    if (move.cat === 'Status') {
      this.applyStatusMove(side, move);
      return;
    }

    if (!accuracyCheck(this.rng, move, state, defenderState)) {
      this.push({ t: 'miss', side });
      this.text(`${displayName(this.ctx, attacker)} errou o golpe!`);
      return;
    }

    if (this.absorbedByAbility(defenderSide, move)) return;

    const hits = this.hitCount(move);
    let totalDamage = 0;
    let lastEffectiveness = 1;

    for (let hit = 0; hit < hits; hit++) {
      if (isFainted(defender)) break;
      const result = calculateDamage(
        this.ctx,
        this.chart,
        this.rng,
        attacker,
        state,
        defender,
        defenderState,
        this.boostedMove(side, move),
      );
      lastEffectiveness = result.effectiveness;

      if (result.effectiveness === 0) {
        this.text(`Nao afeta ${displayName(this.ctx, defender)}...`);
        return;
      }

      let damage = Math.min(result.damage, defender.hp);
      // Sturdy segura um golpe fatal com o HP cheio.
      if (
        damage >= defender.hp &&
        defender.hp === maxHp(this.ctx, defender) &&
        this.abilityOf(defenderSide) === 'sturdy'
      ) {
        damage = defender.hp - 1;
        this.text(`${displayName(this.ctx, defender)} aguentou com Sturdy!`);
      }

      defender.hp -= damage;
      totalDamage += damage;
      this.push({
        t: 'damage',
        side: defenderSide,
        amount: damage,
        hp: defender.hp,
        maxHp: maxHp(this.ctx, defender),
        effectiveness: describeEffectiveness(result.effectiveness),
        crit: result.crit,
      });
      if (result.crit) this.text('Foi um acerto critico!');
    }

    if (hits > 1) this.text(`Acertou ${hits} vezes!`);
    if (lastEffectiveness > 1) this.text('Foi muito eficaz!');
    else if (lastEffectiveness < 1 && lastEffectiveness > 0) this.text('Nao foi muito eficaz...');

    this.applyDrainAndRecoil(side, move, totalDamage);
    if (!isFainted(defender)) this.applySecondary(side, move);
    this.contactAbilities(side, move);

    if (move.selfdestruct) {
      attacker.hp = 0;
      this.text(`${displayName(this.ctx, attacker)} se explodiu!`);
    }
  }

  private struggle(side: Side): void {
    const attacker = this.active(side);
    const defenderSide = this.other(side);
    const defender = this.active(defenderSide);
    if (!this.canAct(side)) return;
    this.push({ t: 'useMove', side, move: 'struggle' });
    this.text(`${displayName(this.ctx, attacker)} usou Struggle!`);
    const damage = Math.max(1, Math.floor(maxHp(this.ctx, defender) / 4));
    defender.hp = Math.max(0, defender.hp - damage);
    this.push({
      t: 'damage',
      side: defenderSide,
      amount: damage,
      hp: defender.hp,
      maxHp: maxHp(this.ctx, defender),
      effectiveness: 'normal',
      crit: false,
    });
    const recoil = Math.max(1, Math.floor(maxHp(this.ctx, attacker) / 4));
    attacker.hp = Math.max(0, attacker.hp - recoil);
    this.text(`${displayName(this.ctx, attacker)} se machucou com o esforco.`);
  }

  /** Checa sono, paralisia, congelamento, confusao e flinch. */
  private canAct(side: Side): boolean {
    const pokemon = this.active(side);
    const state = this.team(side).state;

    if (state.flinched) {
      state.flinched = false;
      this.text(`${displayName(this.ctx, pokemon)} hesitou!`);
      return false;
    }

    if (pokemon.status === 'slp') {
      if (pokemon.sleepTurns > 0) {
        pokemon.sleepTurns--;
        this.text(`${displayName(this.ctx, pokemon)} esta dormindo.`);
        return false;
      }
      pokemon.status = null;
      this.push({ t: 'status', side, status: null });
      this.text(`${displayName(this.ctx, pokemon)} acordou!`);
    }

    if (pokemon.status === 'frz') {
      if (this.rng.next() < 0.2) {
        pokemon.status = null;
        this.push({ t: 'status', side, status: null });
        this.text(`${displayName(this.ctx, pokemon)} descongelou!`);
      } else {
        this.text(`${displayName(this.ctx, pokemon)} esta congelado!`);
        return false;
      }
    }

    if (pokemon.status === 'par' && this.rng.next() < 0.25) {
      this.text(`${displayName(this.ctx, pokemon)} esta paralisado e nao conseguiu se mexer!`);
      return false;
    }

    if (state.confusionTurns > 0) {
      state.confusionTurns--;
      if (state.confusionTurns === 0) {
        this.text(`${displayName(this.ctx, pokemon)} saiu da confusao!`);
      } else {
        this.text(`${displayName(this.ctx, pokemon)} esta confuso!`);
        if (this.rng.next() < 1 / 3) {
          const damage = confusionDamage(this.ctx, this.rng, pokemon, state);
          pokemon.hp = Math.max(0, pokemon.hp - damage);
          this.push({
            t: 'damage',
            side,
            amount: damage,
            hp: pokemon.hp,
            maxHp: maxHp(this.ctx, pokemon),
            effectiveness: 'normal',
            crit: false,
          });
          this.text('Ele se machucou na propria confusao!');
          return false;
        }
      }
    }

    return true;
  }

  private applyStatusMove(side: Side, move: MoveData): void {
    const targetSide = move.target === 'self' || move.target === 'allySide' ? side : this.other(side);
    const targetState = this.team(targetSide).state;
    const target = this.active(targetSide);
    const user = this.active(side);

    if (targetSide !== side && !accuracyCheck(this.rng, move, this.team(side).state, targetState)) {
      this.push({ t: 'miss', side });
      this.text('Mas errou!');
      return;
    }

    let didSomething = false;

    if (move.boosts) {
      for (const [stat, delta] of Object.entries(move.boosts)) {
        if (this.applyBoost(targetSide, stat as StatName, delta as number)) didSomething = true;
      }
    }
    if (move.self?.boosts) {
      for (const [stat, delta] of Object.entries(move.self.boosts)) {
        if (this.applyBoost(side, stat as StatName, delta as number)) didSomething = true;
      }
    }
    if (move.status && this.applyStatus(targetSide, move.status, move)) didSomething = true;
    if (move.volatile === 'confusion' && targetState.confusionTurns === 0) {
      targetState.confusionTurns = this.rng.range(2, 5);
      this.text(`${displayName(this.ctx, target)} ficou confuso!`);
      didSomething = true;
    }
    if (move.heal) {
      const max = maxHp(this.ctx, user);
      const amount = Math.min(max - user.hp, Math.floor((max * move.heal[0]) / move.heal[1]));
      if (amount > 0) {
        user.hp += amount;
        this.push({ t: 'heal', side, amount, hp: user.hp, maxHp: max });
        this.text(`${displayName(this.ctx, user)} recuperou HP.`);
        didSomething = true;
      }
    }

    if (!didSomething) this.text('Mas nao teve efeito...');
  }

  private applyBoost(side: Side, stat: StatName | 'accuracy' | 'evasion', delta: number): boolean {
    if (stat === 'hp') return false;
    const state = this.team(side).state;
    const key = stat as keyof ActiveState['boosts'];
    const before = state.boosts[key];
    const after = clampStage(before + delta);
    if (before === after) {
      this.text(
        `${displayName(this.ctx, this.active(side))} nao pode ${delta > 0 ? 'aumentar' : 'reduzir'} mais o ${STAT_LABEL[stat]}!`,
      );
      return false;
    }
    state.boosts[key] = after;
    this.push({ t: 'boost', side, stat, delta: after - before });
    const label = STAT_LABEL[stat] ?? stat;
    const magnitude = Math.abs(delta) >= 2 ? 'muito ' : '';
    this.text(
      `${displayName(this.ctx, this.active(side))} ${delta > 0 ? `aumentou ${magnitude}o` : `reduziu ${magnitude}o`} ${label}!`,
    );
    return true;
  }

  private applyStatus(side: Side, status: StatusName, move?: MoveData): boolean {
    const pokemon = this.active(side);
    if (pokemon.status) return false;

    // Imunidades por tipo.
    const types = speciesOf(this.ctx, pokemon).t;
    if ((status === 'psn' || status === 'tox') && (types.includes('Poison') || types.includes('Steel'))) {
      return false;
    }
    if (status === 'brn' && types.includes('Fire')) return false;
    if (status === 'frz' && types.includes('Ice')) return false;
    if (status === 'par' && types.includes('Electric')) return false;

    const ability = this.abilityOf(side);
    if (ability === 'limber' && status === 'par') return false;
    if (ability === 'insomnia' && status === 'slp') return false;
    if (ability === 'immunity' && (status === 'psn' || status === 'tox')) return false;
    if (ability === 'waterveil' && status === 'brn') return false;

    pokemon.status = status;
    if (status === 'slp') pokemon.sleepTurns = this.rng.range(1, 3);
    this.push({ t: 'status', side, status });
    this.text(`${displayName(this.ctx, pokemon)} ${STATUS_LABEL[status]}!`);
    void move;
    return true;
  }

  private applySecondary(side: Side, move: MoveData): void {
    const secondary = move.secondary;
    if (!secondary) return;
    if (this.rng.next() * 100 >= secondary.chance) return;

    const targetSide = this.other(side);
    if (secondary.status) this.applyStatus(targetSide, secondary.status, move);
    if (secondary.volatile === 'flinch') this.team(targetSide).state.flinched = true;
    if (secondary.volatile === 'confusion') {
      const state = this.team(targetSide).state;
      if (state.confusionTurns === 0) {
        state.confusionTurns = this.rng.range(2, 5);
        this.text(`${displayName(this.ctx, this.active(targetSide))} ficou confuso!`);
      }
    }
    if (secondary.boosts) {
      for (const [stat, delta] of Object.entries(secondary.boosts)) {
        this.applyBoost(targetSide, stat as StatName, delta as number);
      }
    }
    if (secondary.self) {
      for (const [stat, delta] of Object.entries(secondary.self)) {
        this.applyBoost(side, stat as StatName, delta as number);
      }
    }
  }

  private applyDrainAndRecoil(side: Side, move: MoveData, damage: number): void {
    const attacker = this.active(side);
    if (move.drain && damage > 0) {
      const max = maxHp(this.ctx, attacker);
      const healed = Math.min(max - attacker.hp, Math.floor((damage * move.drain[0]) / move.drain[1]));
      if (healed > 0) {
        attacker.hp += healed;
        this.push({ t: 'heal', side, amount: healed, hp: attacker.hp, maxHp: max });
        this.text(`${displayName(this.ctx, attacker)} drenou energia!`);
      }
    }
    if (move.recoil && damage > 0) {
      const recoil = Math.max(1, Math.floor((damage * move.recoil[0]) / move.recoil[1]));
      attacker.hp = Math.max(0, attacker.hp - recoil);
      this.push({
        t: 'damage',
        side,
        amount: recoil,
        hp: attacker.hp,
        maxHp: maxHp(this.ctx, attacker),
        effectiveness: 'normal',
        crit: false,
      });
      this.text(`${displayName(this.ctx, attacker)} sofreu com o recuo.`);
    }
  }

  private hitCount(move: MoveData): number {
    if (!move.multihit) return 1;
    if (typeof move.multihit === 'number') return move.multihit;
    const [min, max] = move.multihit;
    if (min === 2 && max === 5) {
      // Distribuicao da Geracao 5: 2 e 3 golpes em 35% cada.
      const roll = this.rng.next();
      return roll < 0.35 ? 2 : roll < 0.7 ? 3 : roll < 0.85 ? 4 : 5;
    }
    return this.rng.range(min, max);
  }

  // --- Habilidades ----------------------------------------------------------

  private abilityOf(side: Side): string {
    return this.active(side).ability.toLowerCase().replace(/[^a-z]/g, '');
  }

  private onSendOut(side: Side): void {
    const ability = this.abilityOf(side);
    if (ability === 'intimidate') {
      this.text(`${displayName(this.ctx, this.active(side))} intimidou o oponente!`);
      this.applyBoost(this.other(side), 'atk', -1);
    }
  }

  /** Levitate, Volt Absorb, Water Absorb e Flash Fire. */
  private absorbedByAbility(defenderSide: Side, move: MoveData): boolean {
    const ability = this.abilityOf(defenderSide);
    const defender = this.active(defenderSide);

    if (ability === 'levitate' && move.t === 'Ground') {
      this.text(`${displayName(this.ctx, defender)} flutua e nao foi atingido!`);
      return true;
    }
    const absorbs =
      (ability === 'voltabsorb' && move.t === 'Electric') ||
      (ability === 'waterabsorb' && move.t === 'Water');
    if (absorbs) {
      const max = maxHp(this.ctx, defender);
      const healed = Math.min(max - defender.hp, Math.floor(max / 4));
      if (healed > 0) {
        defender.hp += healed;
        this.push({ t: 'heal', side: defenderSide, amount: healed, hp: defender.hp, maxHp: max });
      }
      this.text(`${displayName(this.ctx, defender)} absorveu o golpe!`);
      return true;
    }
    if (ability === 'flashfire' && move.t === 'Fire') {
      this.text(`${displayName(this.ctx, defender)} absorveu as chamas!`);
      return true;
    }
    return false;
  }

  /** Static, Flame Body e Poison Point respondem a golpes de contato. */
  private contactAbilities(side: Side, move: MoveData): void {
    if (!move.contact) return;
    const defenderSide = this.other(side);
    const ability = this.abilityOf(defenderSide);
    if (this.rng.next() >= 0.3) return;
    if (ability === 'static') this.applyStatus(side, 'par');
    else if (ability === 'flamebody') this.applyStatus(side, 'brn');
    else if (ability === 'poisonpoint') this.applyStatus(side, 'psn');
  }

  /** Overgrow e companhia: +50% no tipo quando o HP esta baixo. */
  private boostedMove(side: Side, move: MoveData): MoveData {
    const pokemon = this.active(side);
    if (pokemon.hp > maxHp(this.ctx, pokemon) / 3) return move;
    const ability = this.abilityOf(side);
    const pairs: Record<string, string> = {
      overgrow: 'Grass',
      blaze: 'Fire',
      torrent: 'Water',
      swarm: 'Bug',
    };
    if (pairs[ability] !== move.t) return move;
    return { ...move, bp: Math.floor(move.bp * 1.5) };
  }

  // --- Fim de turno ---------------------------------------------------------

  private endOfTurn(): void {
    this.player.state.protected = false;
    this.foe.state.protected = false;

    for (const side of ['player', 'foe'] as Side[]) {
      const pokemon = this.active(side);
      if (isFainted(pokemon)) continue;
      const max = maxHp(this.ctx, pokemon);

      if (pokemon.status === 'brn' || pokemon.status === 'psn') {
        const damage = Math.max(1, Math.floor(max / 8));
        pokemon.hp = Math.max(0, pokemon.hp - damage);
        this.push({
          t: 'damage',
          side,
          amount: damage,
          hp: pokemon.hp,
          maxHp: max,
          effectiveness: 'normal',
          crit: false,
        });
        this.text(
          `${displayName(this.ctx, pokemon)} ${pokemon.status === 'brn' ? 'sofre com a queimadura' : 'sofre com o veneno'}.`,
        );
      }
    }
    this.checkFaints();
  }

  private checkFaints(): void {
    for (const side of ['foe', 'player'] as Side[]) {
      const pokemon = this.active(side);
      if (!isFainted(pokemon)) continue;
      this.push({ t: 'faint', side });
      this.text(`${displayName(this.ctx, pokemon)} desmaiou!`);

      if (side === 'foe') {
        this.awardExp(pokemon);
        const next = firstHealthy(this.foe.party);
        if (next < 0) {
          this.finish('win');
          return;
        }
        this.foe.activeIndex = next;
        this.foe.state = freshActiveState();
        this.push({ t: 'sendOut', side: 'foe', index: next });
        this.text(
          `${this.config.foeName ?? 'O oponente'} enviou ${displayName(this.ctx, this.active('foe'))}!`,
        );
        this.onSendOut('foe');
      } else {
        const next = firstHealthy(this.player.party);
        if (next < 0) {
          this.finish('loss');
          return;
        }
        this.awaitingSwitch = true;
        this.push({ t: 'prompt', kind: 'chooseSwitch' });
      }
    }
  }

  private awardExp(defeated: Pokemon): void {
    const participants = this.player.party.filter(
      (p) => this.participants.has(p.uid) && !isFainted(p),
    );
    if (participants.length === 0) return;

    for (const pokemon of participants) {
      if (pokemon.level >= MAX_LEVEL) continue;
      const gained = expGained(this.ctx, defeated, pokemon.level, {
        trainerBattle: this.config.kind === 'trainer',
        participants: participants.length,
      });
      pokemon.exp += gained;

      const growth = speciesOf(this.ctx, pokemon).growth;
      let leveledUp = false;
      while (pokemon.level < MAX_LEVEL && pokemon.exp >= expForLevel(growth, pokemon.level + 1)) {
        const beforeMax = maxHp(this.ctx, pokemon);
        pokemon.level++;
        leveledUp = true;
        // Subir de nivel aumenta o HP maximo e o atual junto.
        pokemon.hp += maxHp(this.ctx, pokemon) - beforeMax;
        this.text(`${displayName(this.ctx, pokemon)} subiu para o nivel ${pokemon.level}!`);

        for (const moveId of movesLearnedAt(this.ctx, pokemon.species, pokemon.level)) {
          if (pokemon.moves.some((m) => m.id === moveId)) continue;
          if (pokemon.moves.length < MOVE_SLOTS) {
            pokemon.moves.push(makeMoveSlot(this.ctx, moveId));
            this.push({ t: 'learnMove', uid: pokemon.uid, move: moveId });
            this.text(`${displayName(this.ctx, pokemon)} aprendeu ${this.ctx.moves[moveId]?.n ?? moveId}!`);
          }
        }

        const evolution = evolutionAt(this.ctx, pokemon);
        if (evolution !== null) {
          this.push({ t: 'evolve', uid: pokemon.uid, from: pokemon.species, to: evolution });
        }
      }

      this.push({ t: 'exp', uid: pokemon.uid, gained, level: pokemon.level, leveledUp });
    }

    // Distribuicao de EVs de quem participou.
    const yields = speciesOf(this.ctx, defeated).ev;
    for (const pokemon of participants) {
      const total = pokemon.evs.reduce((a, b) => a + b, 0);
      for (let i = 0; i < 6 && total < 510; i++) {
        pokemon.evs[i] = Math.min(252, pokemon.evs[i] + (yields[i] ?? 0));
      }
    }
  }

  private finish(outcome: BattleOutcome): void {
    this.outcome = outcome;
    this.push({ t: 'end', outcome });
  }

  // --- Utilidades -----------------------------------------------------------

  private push(event: BattleEvent): void {
    this.events.push(event);
  }

  private text(text: string): void {
    this.events.push({ t: 'text', text });
  }

  /** Usado pela IA: quanto este golpe machucaria o alvo. */
  estimateDamage(side: Side, moveId: string): number {
    const move = this.ctx.moves[moveId];
    if (!move || move.cat === 'Status') return 0;
    const attacker = this.active(side);
    const defenderSide = this.other(side);
    const defender = this.active(defenderSide);
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

export function firstHealthy(party: Pokemon[]): number {
  return party.findIndex((p) => !isFainted(p));
}
