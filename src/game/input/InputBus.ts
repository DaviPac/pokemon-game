/**
 * Ponte entre os controles (React) e o loop do jogo. Os controles escrevem
 * aqui, o loop le a cada quadro -- assim nenhum toque provoca re-render.
 */
import type { Direction } from '../data/types.js';

export type MovementMode = 'legacy-dpad' | 'legacy-stick' | 'oldschool-dual' | 'touch' | 'new';

export const MOVEMENT_MODES: { id: MovementMode; label: string; hint: string }[] = [
  {
    id: 'new',
    label: 'Novo',
    hint: 'Deslize o dedo para andar. Um toque rapido, ou segurar parado, interage com o que esta na frente.',
  },
  {
    id: 'touch',
    label: 'Toque',
    hint: 'Toque em um ponto do mapa e o personagem caminha ate la sozinho.',
  },
  {
    id: 'legacy-stick',
    label: 'Classico (analogico)',
    hint: 'Analogico na esquerda e botoes A/B na direita, como um emulador.',
  },
  {
    id: 'legacy-dpad',
    label: 'Classico (direcional)',
    hint: 'Direcional de setas e botoes A/B, igual ao Game Boy Advance.',
  },
  {
    id: 'oldschool-dual',
    label: 'Duas telas',
    hint: 'Mapa em cima, painel estilo Game Boy Color embaixo com os controles.',
  },
];

export type ActionButton = 'a' | 'b';

export class InputBus {
  /** Direcao segurada no momento, ou null quando parado. */
  dir: Direction | null = null;
  running = false;
  /** Caminho pendente do modo de toque, em coordenadas do mapa. */
  path: { x: number; y: number }[] | null = null;

  private pending: ActionButton[] = [];

  press(button: ActionButton): void {
    this.pending.push(button);
  }

  /** Consome o proximo botao apertado (o loop chama uma vez por quadro). */
  takeAction(): ActionButton | null {
    return this.pending.shift() ?? null;
  }

  clear(): void {
    this.dir = null;
    this.running = false;
    this.path = null;
    this.pending.length = 0;
  }
}

/** Converte um vetor de arrasto na direcao cardeal dominante. */
export function vectorToDirection(dx: number, dy: number, deadzone: number): Direction | null {
  if (Math.hypot(dx, dy) < deadzone) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}
