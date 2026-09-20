/**
 * Caixa de fala. Escreve letra a letra (o charme dos jogos originais), mas com
 * area de toque grande e fecha em qualquer lugar da tela.
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  /** Substitui {PLAYER} nas falas originais do jogo. */
  playerName?: string;
  onClose: () => void;
}

const CHAR_MS = 18;

export function Dialogue({ text: raw, playerName, onClose }: Props) {
  const text = playerName ? raw.replaceAll('{PLAYER}', playerName) : raw;
  const [shown, setShown] = useState('');
  const doneRef = useRef(false);

  useEffect(() => {
    setShown('');
    doneRef.current = false;
    let index = 0;
    const timer = setInterval(() => {
      index++;
      setShown(text.slice(0, index));
      if (index >= text.length) {
        doneRef.current = true;
        clearInterval(timer);
      }
    }, CHAR_MS);
    return () => clearInterval(timer);
  }, [text]);

  const advance = () => {
    if (doneRef.current) onClose();
    else {
      doneRef.current = true;
      setShown(text);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'z', 'Z', 'x', 'X', 'Escape'].includes(e.key)) advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="dialogue-layer" onPointerDown={advance}>
      <div className="dialogue-box">
        <p>{shown}</p>
        <span className="dialogue-next">▾</span>
      </div>
    </div>
  );
}
