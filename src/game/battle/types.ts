import type { BoostTable, StatName, StatusName } from '../data/types.js';
import type { Pokemon } from '../pokemon/pokemon.js';

export type Side = 'player' | 'foe';

/** Estado volatil de um lado, zerado quando o Pokemon troca. */
export interface ActiveState {
  boosts: Required<Pick<BoostTable, 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion'>>;
  confusionTurns: number;
  flinched: boolean;
  protected: boolean;
  /** Turnos seguidos usando o mesmo golpe, para Protect e afins. */
  consecutiveProtect: number;
  /** Ja esteve em campo neste combate? Conta para dividir a EXP. */
  participated: boolean;
  chargingMove: string | null;
  lastMove: string | null;
  substituteHp: number;
  trapped: boolean;
}

export interface BattleTeam {
  party: Pokemon[];
  activeIndex: number;
  state: ActiveState;
}

export type BattleKind = 'wild' | 'trainer';

export interface BattleConfig {
  kind: BattleKind;
  /** Nome do treinador adversario, quando houver. */
  foeName?: string;
  /** Recompensa em dinheiro de uma batalha de treinador. */
  prize?: number;
  canRun: boolean;
  mapId?: string;
}

export type BattleAction =
  | { kind: 'move'; index: number }
  | { kind: 'switch'; index: number }
  | { kind: 'item'; item: string; targetIndex?: number }
  | { kind: 'run' };

export type Effectiveness = 'immune' | 'resisted' | 'normal' | 'super';

export type BattleEvent =
  | { t: 'text'; text: string }
  | { t: 'sendOut'; side: Side; index: number }
  | { t: 'useMove'; side: Side; move: string }
  | { t: 'damage'; side: Side; amount: number; hp: number; maxHp: number; effectiveness: Effectiveness; crit: boolean }
  | { t: 'heal'; side: Side; amount: number; hp: number; maxHp: number }
  | { t: 'miss'; side: Side }
  | { t: 'status'; side: Side; status: StatusName | null }
  | { t: 'boost'; side: Side; stat: StatName | 'accuracy' | 'evasion'; delta: number }
  | { t: 'faint'; side: Side }
  | { t: 'ball'; shakes: number; caught: boolean; ball: string }
  | { t: 'caught'; species: number }
  | { t: 'exp'; uid: string; gained: number; level: number; leveledUp: boolean }
  | { t: 'learnMove'; uid: string; move: string }
  | { t: 'evolve'; uid: string; from: number; to: number }
  | { t: 'prompt'; kind: 'chooseSwitch' }
  | { t: 'end'; outcome: BattleOutcome };

export type BattleOutcome = 'win' | 'loss' | 'caught' | 'fled' | 'foeFled';

export const EMPTY_BOOSTS = (): ActiveState['boosts'] => ({
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
  accuracy: 0,
  evasion: 0,
});

export const freshActiveState = (): ActiveState => ({
  boosts: EMPTY_BOOSTS(),
  confusionTurns: 0,
  flinched: false,
  protected: false,
  consecutiveProtect: 0,
  participated: true,
  chargingMove: null,
  lastMove: null,
  substituteHp: 0,
  trapped: false,
});
