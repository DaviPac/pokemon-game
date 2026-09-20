/**
 * Os cinco modos de locomocao. Todos escrevem no mesmo InputBus, entao o loop
 * do jogo nao sabe (nem precisa saber) qual esta ativo.
 */
import { useEffect, useRef, useState } from 'react';
import type { Direction } from '../../game/data/types.js';
import { InputBus, type MovementMode, vectorToDirection } from '../../game/input/InputBus.js';
import { haptic } from '../../state/settings.js';

interface Props {
  bus: InputBus;
  mode: MovementMode;
  onMenu: () => void;
}

export function Controls({ bus, mode, onMenu }: Props) {
  switch (mode) {
    case 'legacy-dpad':
      return <LegacyControls bus={bus} stick={false} onMenu={onMenu} />;
    case 'legacy-stick':
      return <LegacyControls bus={bus} stick onMenu={onMenu} />;
    case 'oldschool-dual':
      return null; // os controles ficam na tela de baixo
    case 'touch':
      return <TouchHint />;
    case 'new':
      return <InvisibleStick bus={bus} />;
  }
}

// --- Modo "novo": analogico invisivel --------------------------------------

/**
 * Arrastar em qualquer ponto da tela anda naquela direcao. Mudar a direcao do
 * arrasto muda o rumo na hora; soltar para. Sem nada desenhado por cima do jogo.
 */
function InvisibleStick({ bus }: { bus: InputBus }) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const pointerId = useRef<number | null>(null);
  // Um toque que nao vira arrasto e uma interacao, nao um passo.
  const pressStart = useRef(0);
  const moved = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const DEADZONE = 14;
  const RUN_DISTANCE = 46;
  const MAX_DRIFT = 58;
  /** Abaixo disto, soltar o dedo conta como toque e nao como arrasto. */
  const TAP_MS = 260;
  /** Segurar parado tambem interage, para quem prefere manter o dedo na tela. */
  const HOLD_MS = 420;

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const release = () => {
    clearHold();
    pointerId.current = null;
    setOrigin(null);
    setKnob(null);
    bus.dir = null;
    bus.running = false;
  };

  useEffect(() => clearHold, []);

  return (
    <div
      className="input-layer"
      onPointerDown={(e) => {
        if (pointerId.current !== null) return;
        pointerId.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setOrigin({ x: e.clientX, y: e.clientY });
        setKnob({ x: e.clientX, y: e.clientY });
        pressStart.current = performance.now();
        moved.current = false;

        clearHold();
        holdTimer.current = setTimeout(() => {
          if (moved.current) return;
          bus.press('a');
          haptic(14);
          moved.current = true; // ja interagiu: soltar nao repete
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (pointerId.current !== e.pointerId || !origin) return;
        let dx = e.clientX - origin.x;
        let dy = e.clientY - origin.y;
        const distance = Math.hypot(dx, dy);

        // O centro segue o dedo quando ele se afasta demais: o analogico
        // "flutua" e nunca perde o alcance, como nos jogos de celular bons.
        if (distance > MAX_DRIFT) {
          const scale = (distance - MAX_DRIFT) / distance;
          const nextOrigin = { x: origin.x + dx * scale, y: origin.y + dy * scale };
          setOrigin(nextOrigin);
          dx = e.clientX - nextOrigin.x;
          dy = e.clientY - nextOrigin.y;
        }

        setKnob({ x: e.clientX, y: e.clientY });
        const dir = vectorToDirection(dx, dy, DEADZONE);
        if (dir) {
          moved.current = true;
          clearHold();
        }
        if (dir !== bus.dir && dir !== null) haptic(6);
        bus.dir = dir;
        bus.running = Math.hypot(dx, dy) > RUN_DISTANCE;
      }}
      onPointerUp={(e) => {
        if (pointerId.current !== e.pointerId) return;
        const quick = performance.now() - pressStart.current < TAP_MS;
        if (quick && !moved.current) {
          bus.press('a');
          haptic(12);
        }
        release();
      }}
      onPointerCancel={release}
    >
      {origin && knob && (
        // Um rastro discreto so para confirmar o toque; some ao soltar.
        <>
          <span className="ghost-stick-base" style={{ left: origin.x, top: origin.y }} />
          <span className="ghost-stick-knob" style={{ left: knob.x, top: knob.y }} />
        </>
      )}
    </div>
  );
}

// --- Modo toque -------------------------------------------------------------

function TouchHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="touch-hint">Toque no mapa para caminhar ate la</div>;
}

// --- Modos classicos --------------------------------------------------------

function LegacyControls({
  bus,
  stick,
  onMenu,
}: {
  bus: InputBus;
  stick: boolean;
  onMenu: () => void;
}) {
  return (
    <div className="legacy-controls">
      <div className="legacy-left">{stick ? <Joystick bus={bus} /> : <DPad bus={bus} />}</div>
      <div className="legacy-right">
        <button
          type="button"
          className="face-button face-b"
          onPointerDown={() => {
            bus.running = true;
            bus.press('b');
            haptic(8);
          }}
          onPointerUp={() => {
            bus.running = false;
          }}
          onPointerLeave={() => {
            bus.running = false;
          }}
          aria-label="Botao B (voltar / correr)"
        >
          B
        </button>
        <button
          type="button"
          className="face-button face-a"
          onPointerDown={() => {
            bus.press('a');
            haptic(10);
          }}
          aria-label="Botao A (confirmar / interagir)"
        >
          A
        </button>
        <button type="button" className="face-button face-start" onClick={onMenu} aria-label="Menu">
          ☰
        </button>
      </div>
    </div>
  );
}

export function DPad({ bus, compact = false }: { bus: InputBus; compact?: boolean }) {
  const hold = (dir: Direction) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      bus.dir = dir;
      haptic(6);
    },
    onPointerUp: () => {
      if (bus.dir === dir) bus.dir = null;
    },
    onPointerLeave: () => {
      if (bus.dir === dir) bus.dir = null;
    },
    onPointerCancel: () => {
      if (bus.dir === dir) bus.dir = null;
    },
  });

  return (
    <div className={compact ? 'dpad dpad-compact' : 'dpad'}>
      <button type="button" className="dpad-btn dpad-up" {...hold('up')} aria-label="Cima" />
      <button type="button" className="dpad-btn dpad-left" {...hold('left')} aria-label="Esquerda" />
      <span className="dpad-center" />
      <button type="button" className="dpad-btn dpad-right" {...hold('right')} aria-label="Direita" />
      <button type="button" className="dpad-btn dpad-down" {...hold('down')} aria-label="Baixo" />
    </div>
  );
}

function Joystick({ bus }: { bus: InputBus }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const RADIUS = 44;

  const update = (clientX: number, clientY: number) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const distance = Math.hypot(dx, dy);
    if (distance > RADIUS) {
      dx = (dx / distance) * RADIUS;
      dy = (dy / distance) * RADIUS;
    }
    setOffset({ x: dx, y: dy });
    const dir = vectorToDirection(dx, dy, 12);
    if (dir !== bus.dir && dir) haptic(6);
    bus.dir = dir;
    bus.running = distance > RADIUS * 0.75;
  };

  const release = () => {
    setOffset({ x: 0, y: 0 });
    bus.dir = null;
    bus.running = false;
  };

  return (
    <div
      ref={baseRef}
      className="joystick"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0 && e.pointerType === 'mouse') return;
        update(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <span className="joystick-knob" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} />
    </div>
  );
}
