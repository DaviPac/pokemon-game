import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { audio } from './game/audio/index.js';
import { useGame } from './state/game.js';
import { applyAudioSettings } from './state/settings.js';
import { initUpdates } from './state/updates.js';
import { App } from './ui/App.js';
import './styles.css';

// Registra o service worker e passa a vigiar versoes novas.
initUpdates();

// Nenhum navegador toca som antes de um gesto: o primeiro toque libera o audio.
const unlockAudio = () => {
  audio.unlock();
  applyAudioSettings();
};
for (const event of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(event, unlockAudio, { once: true, passive: true });
}

// Em desenvolvimento, os scripts de teste conferem por aqui qual musica esta
// tocando (nao da para "ouvir" uma pagina de dentro do navegador) e preparam o
// save para chegar depressa na situacao que querem testar.
if (import.meta.env.DEV) {
  const globals = window as unknown as { __audio?: typeof audio; __game?: typeof useGame };
  globals.__audio = audio;
  globals.__game = useGame;
}

const root = document.getElementById('root');
if (!root) throw new Error('elemento #root nao encontrado');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
