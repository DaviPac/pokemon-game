/**
 * A barra inferior, no espirito do Dock do Mac e do iPad: uma ilha de vidro
 * flutuando sobre o jogo.
 *
 * Tres coisas vem de la, e todas tem motivo:
 *
 * - O icone sob o dedo cresce e os vizinhos abrem espaco. Num alvo pequeno,
 *   isso mostra em que item o toque vai cair antes de solta-lo.
 * - O nome da aba aberta fica sempre a vista; o dos outros aparece quando o
 *   icone cresce, como a etiqueta do Dock. A barra fica limpa sem deixar
 *   ninguem adivinhando o que cada icone faz.
 * - Andando pelo mapa, a barra se recolhe e deixa so um risquinho, igual ao
 *   Dock do iPad em tela cheia. Um toque ali, ou parar de andar, traz de volta.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { audio } from '../../game/audio/index.js';
import { haptic } from '../../state/settings.js';
import { BagIcon, BallIcon, DexIcon, MapIcon, TrainerIcon } from './icons.js';

export type Tab = 'map' | 'pokedex' | 'team' | 'bag' | 'profile';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  /** Aviso vermelho no perfil (expedicao pronta, missao para resgatar). */
  badge?: boolean;
  /** Recolhe a barra: o jogador esta andando e a tela e do mapa. */
  collapsed?: boolean;
}

const ITEMS: { id: Tab; label: string; Icon: (props: { size?: number }) => ReactElement }[] = [
  { id: 'pokedex', label: 'Pokedex', Icon: DexIcon },
  { id: 'team', label: 'Equipe', Icon: BallIcon },
  { id: 'map', label: 'Mapa', Icon: MapIcon },
  { id: 'bag', label: 'Mochila', Icon: BagIcon },
  { id: 'profile', label: 'Perfil', Icon: TrainerIcon },
];

/** Largura, em pixels, do "campo" de aumento em volta do dedo. */
const REACH = 56;
/** Quanto os vizinhos andam para o lado para abrir espaco. */
const PUSH = 30;
/** Quanto tempo a barra fica a vista depois de o jogador chama-la. */
const PEEK_MS = 5000;

export function BottomNav({ active, onChange, badge, collapsed = false }: Props) {
  const dockRef = useRef<HTMLElement>(null);
  /** O jogador pediu a barra de volta mesmo andando. */
  const [peeking, setPeeking] = useState(false);
  // Quem pediu a barra de volta nao quer ela sumindo no meio do caminho, mas
  // tambem nao quer que ela fique ali para sempre.
  useEffect(() => {
    if (!peeking) return;
    const timer = setTimeout(() => setPeeking(false), PEEK_MS);
    return () => clearTimeout(timer);
  }, [peeking]);

  useEffect(() => {
    if (!collapsed) setPeeking(false);
  }, [collapsed]);

  const hidden = collapsed && !peeking;

  /**
   * Distribui o aumento pelos icones conforme a distancia ate o dedo. Mexe no
   * estilo direto, e nao no estado do React: isto roda a cada movimento do
   * dedo e nao pode custar um render.
   */
  const magnify = (clientX: number | null) => {
    const dock = dockRef.current;
    if (!dock) return;
    const rect = dock.getBoundingClientRect();
    for (const item of dock.querySelectorAll<HTMLElement>('.dock-item')) {
      const center = item.offsetLeft + item.offsetWidth / 2;
      const distance = clientX === null ? Infinity : clientX - rect.left - center;
      const spread = distance / REACH;
      const grow = Number.isFinite(spread) ? Math.exp(-spread * spread) : 0;
      item.style.setProperty('--grow', grow.toFixed(3));
      // A etiqueta segue uma curva bem mais fechada que o tamanho: so o item
      // debaixo do dedo mostra o nome, sem os vizinhos poluindo a tela.
      item.style.setProperty('--label', (grow ** 6).toFixed(3));
      // O deslocamento e zero embaixo do dedo e maximo um pouco ao lado: e o
      // que faz os vizinhos "abrirem" em vez de serem cobertos.
      item.style.setProperty('--slide', `${(Number.isFinite(spread) ? spread * grow : 0) * PUSH}px`);
    }
    dock.style.setProperty(
      '--sheen',
      clientX === null ? '50%' : `${Math.round(clientX - rect.left)}px`,
    );
    dock.classList.toggle('dock-touching', clientX !== null);
  };

  return (
    <>
      {/* Faixa que escuta o toque na beirada quando a barra esta recolhida. */}
      {hidden && (
        <button
          type="button"
          className="dock-handle"
          aria-label="Mostrar a barra de navegacao"
          onPointerDown={() => {
            haptic(6);
            setPeeking(true);
          }}
        >
          <span className="dock-grip" />
        </button>
      )}

      <nav
        ref={dockRef}
        className={`dock bottom-nav${hidden ? ' dock-hidden' : ''}`}
        onPointerMove={(e) => magnify(e.clientX)}
        onPointerLeave={() => magnify(null)}
        onPointerCancel={() => magnify(null)}
        onPointerUp={() => magnify(null)}
        aria-hidden={hidden}
      >
        {ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`dock-item nav-item${isActive ? ' dock-item-active' : ''}`}
              onClick={() => {
                haptic(8);
                audio.sfx('click');
                onChange(item.id);
              }}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="dock-label">{item.label}</span>
              <span className="dock-tile">
                <item.Icon />
                {item.id === 'profile' && badge && <span className="dock-badge" />}
              </span>
              <span className="dock-dot" />
            </button>
          );
        })}
      </nav>
    </>
  );
}
