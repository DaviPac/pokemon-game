/**
 * Bottom sheet arrastavel -- o padrao de menu deste jogo, no lugar das caixas
 * de texto quadradas dos jogos antigos.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title?: string;
  children: ReactNode;
  onClose: () => void;
  /** Altura em porcentagem da tela. */
  height?: number;
}

export function Sheet({ title, children, onClose, height = 72 }: Props) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <section
        className="sheet"
        style={{ height: `${height}%`, transform: `translateY(${dragY}px)` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header
          className="sheet-handle-area"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (startY.current === null) return;
            setDragY(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            if (dragY > 90) onClose();
            setDragY(0);
            startY.current = null;
          }}
        >
          <span className="sheet-handle" />
          {title && <h2 className="sheet-title">{title}</h2>}
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
