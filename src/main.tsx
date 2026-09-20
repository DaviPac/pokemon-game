import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { audio } from './game/audio/index.js';
import { applyAudioSettings } from './state/settings.js';
import { App } from './ui/App.js';
import './styles.css';

registerSW({ immediate: true });

// Nenhum navegador toca som antes de um gesto: o primeiro toque libera o audio.
const unlockAudio = () => {
  audio.unlock();
  applyAudioSettings();
};
for (const event of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(event, unlockAudio, { once: true, passive: true });
}

const root = document.getElementById('root');
if (!root) throw new Error('elemento #root nao encontrado');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
