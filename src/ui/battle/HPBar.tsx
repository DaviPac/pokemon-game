import type { StatusName } from '../../game/data/types.js';
import { STATUS_COLORS, STATUS_LABELS } from '../theme/types.js';

interface Props {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status: StatusName | null;
  gender?: 'M' | 'F' | 'N';
  /** Barra de EXP (0..1); so aparece para os Pokemon do jogador. */
  exp?: number;
  shiny?: boolean;
  align: 'left' | 'right';
}

export function HPBar({ name, level, hp, maxHp, status, gender, exp, shiny, align }: Props) {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  // Verde, amarelo e vermelho, como na serie.
  const color = ratio > 0.5 ? '#4cd964' : ratio > 0.2 ? '#ffcb3d' : '#ff453a';

  return (
    <div className={`hp-card hp-card-${align}`}>
      <div className="hp-head">
        <span className="hp-name">
          {name}
          {shiny && <span className="shiny-star" title="Shiny">✦</span>}
          {gender === 'M' && <span className="gender male">♂</span>}
          {gender === 'F' && <span className="gender female">♀</span>}
        </span>
        <span className="hp-level">Nv{level}</span>
      </div>
      <div className="hp-track">
        <div className="hp-fill" style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
      <div className="hp-foot">
        {status && (
          <span className="status-chip" style={{ background: STATUS_COLORS[status] }}>
            {STATUS_LABELS[status]}
          </span>
        )}
        {exp !== undefined ? (
          <div className="exp-track">
            <div className="exp-fill" style={{ width: `${Math.max(0, Math.min(1, exp)) * 100}%` }} />
          </div>
        ) : null}
        {exp !== undefined && (
          <span className="hp-numbers">
            {Math.max(0, hp)}/{maxHp}
          </span>
        )}
      </div>
    </div>
  );
}
