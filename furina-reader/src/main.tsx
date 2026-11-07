import '@fontsource-variable/manrope';
import '@fontsource-variable/fraunces';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './platform';

window.addEventListener('unhandledrejection', (e) => console.error('[furina] unhandled', e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const boot = document.getElementById('boot');
if (boot) {
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 450);
}
registerServiceWorker();
