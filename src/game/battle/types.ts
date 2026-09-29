import type { StatName, StatusName } from '../data/types.js';
import type { Pokemon } from '../pokemon/pokemon.js';

export type Side = 'player' | 'foe';

export interface BattleTeam {
  party: Pokemon[];
  /** Quem esta em campo, pela posicao na equipe. */
  activeIndex: number;
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
  // Os eventos carregam o estado do momento em que aconteceram: a interface
  // anima o turno passo a passo, e nao pode ler o motor (que ja resolveu tudo).
  | {
      t: 'sendOut';
      side: Side;
      index: number;
      hp: number;
      maxHp: number;
      status: StatusName | null;
      /** Modo de entrada: pela bola do jogador, do treinador, ou selvagem. */
      entrance: 'player' | 'trainer' | 'wild';
    }
  | {
      t: 'useMove';
      side: Side;
      move: string;
      /** Quem o golpe mira; nulo quando nao ha alvo (ou e o proprio usuario). */
      target?: Side | null;
      /** O golpe saiu, mas errou: a animacao vai no vazio. */
      miss?: boolean;
      /** Sem animacao, como no turno em que um golpe carrega. */
      still?: boolean;
    }
  /** Primeiro turno de golpes que carregam (Solar Beam, Fly...). */
  | { t: 'prepare'; side: Side; move: string; target: Side | null }
  /** Animacao de status: veneno, sono, confusao... */
  | { t: 'anim'; side: Side; anim: string }
  | { t: 'weather'; weather: string | null }
  | {
      t: 'damage';
      side: Side;
      amount: number;
      hp: number;
      maxHp: number;
      effectiveness: Effectiveness;
      crit: boolean;
      /** De onde veio o dano quando nao foi um golpe direto (psn, recoil...). */
      cause?: string;
    }
  | { t: 'heal'; side: Side; amount: number; hp: number; maxHp: number }
  | { t: 'miss'; side: Side }
  | { t: 'status'; side: Side; status: StatusName | null }
  | { t: 'boost'; side: Side; stat: StatName | 'accuracy' | 'evasion'; delta: number }
  | { t: 'faint'; side: Side; uid: string }
  | { t: 'ball'; shakes: number; caught: boolean; ball: string }
  | { t: 'caught'; species: number }
  | {
      t: 'exp';
      uid: string;
      gained: number;
      level: number;
      leveledUp: boolean;
      /** Progresso 0..1 dentro do nivel, para a barra de EXP. */
      progress: number;
      hp: number;
      maxHp: number;
    }
  | { t: 'learnMove'; uid: string; move: string }
  | { t: 'evolve'; uid: string; from: number; to: number }
  | { t: 'prompt'; kind: 'chooseSwitch' }
  | { t: 'end'; outcome: BattleOutcome };

export type BattleOutcome = 'win' | 'loss' | 'caught' | 'fled' | 'foeFled';
