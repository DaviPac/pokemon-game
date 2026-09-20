import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App.js';
import './styles.css';

registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('elemento #root nao encontrado');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
