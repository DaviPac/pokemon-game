/**
 * Caixa de fala. Escreve letra a letra (o charme dos jogos originais), mas com
 * area de toque grande e fecha em qualquer lugar da tela.
 *
 * Um toque enquanto a fala esta sendo escrita completa ela na hora; o toque
 * seguinte, com a fala ja inteira na tela, passa adiante. A setinha embaixo so
 * aparece quando o texto acabou: e ela que avisa que o proximo toque avanca.
 */
import { useEffect, useRef, useState } from 'react';
import { audio } from '../../game/audio/index.js';

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
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTyping = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    setShown('');
    setDone(false);
    let index = 0;
    stopTyping();
    timer.current = setInterval(() => {
      index++;
      setShown(text.slice(0, index));
      if (index >= text.length) {
        stopTyping();
        setDone(true);
      }
    }, CHAR_MS);
    return stopTyping;
  }, [text]);

  const advance = () => {
    if (done) {
      audio.sfx('select');
      onClose();
      return;
    }
    // Sem parar o relogio aqui, ele continuava escrevendo por cima e devolvia
    // a fala pela metade -- era por isso que o toque parecia pular a fala.
    stopTyping();
    setShown(text);
    setDone(true);
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
        {done && <span className="dialogue-next">▾</span>}
      </div>
    </div>
  );
}
