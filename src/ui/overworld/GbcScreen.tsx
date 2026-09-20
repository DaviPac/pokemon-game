/**
 * Tela de baixo do modo "duas telas": um painel com a cara de Game Boy Color
 * (quatro tons de verde, moldura e fonte de pixel) segurando os controles.
 */
import type { ReactNode } from 'react';
import type { InputBus } from '../../game/input/InputBus.js';
import { haptic } from '../../state/settings.js';

interface Props {
  title: string;
  left: ReactNode;
  bus: InputBus;
  onMenu: () => void;
}

export function GbcScreen({ title, left, bus, onMenu }: Props) {
  return (
    <div className="gbc-screen">
      <div className="gbc-frame">
        <div className="gbc-controls-left">{left}</div>

        <div className="gbc-panel">
          <p className="gbc-title">{title}</p>
          <ul className="gbc-menu">
            <li onClick={onMenu}>▸ MENU</li>
            <li onClick={() => bus.press('a')}>▸ FALAR</li>
            <li onClick={() => bus.press('b')}>▸ VOLTAR</li>
          </ul>
        </div>

        <div className="gbc-controls-right">
          <button
            type="button"
            className="gbc-button"
            onPointerDown={() => {
              bus.press('b');
              bus.running = true;
              haptic(8);
            }}
            onPointerUp={() => {
              bus.running = false;
            }}
            onPointerLeave={() => {
              bus.running = false;
            }}
          >
            B
          </button>
          <button
            type="button"
            className="gbc-button"
            onPointerDown={() => {
              bus.press('a');
              haptic(10);
            }}
          >
            A
          </button>
        </div>
      </div>
    </div>
  );
}
