/**
 * Navegacao inferior com o botao central grande, no espirito do Pokemon GO:
 * o mapa e o centro do jogo, o resto orbita em volta.
 */
import { audio } from '../../game/audio/index.js';
import { haptic } from '../../state/settings.js';

export type Tab = 'map' | 'pokedex' | 'team' | 'bag' | 'profile';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  /** Aviso vermelho no perfil (expedicao pronta, missao para resgatar). */
  badge?: boolean;
}

const ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'pokedex', label: 'Pokedex', icon: '◉' },
  { id: 'team', label: 'Equipe', icon: '❖' },
  { id: 'map', label: 'Mapa', icon: '▲' },
  { id: 'bag', label: 'Mochila', icon: '▣' },
  { id: 'profile', label: 'Perfil', icon: '☰' },
];

export function BottomNav({ active, onChange, badge }: Props) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => {
        const isCenter = item.id === 'map';
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={[
              'nav-item',
              isCenter ? 'nav-item-center' : '',
              isActive ? 'nav-item-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              haptic(8);
              audio.sfx('click');
              onChange(item.id);
            }}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.id === 'profile' && badge && <span className="nav-badge" />}
          </button>
        );
      })}
    </nav>
  );
}
