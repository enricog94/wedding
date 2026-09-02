import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_WEDDING } from '../lib/config';
import { applyWeddingTheme, getWeddingTheme } from '../lib/themes';
import { App } from './App';
import './styles.css';

applyWeddingTheme(getWeddingTheme(DEFAULT_WEDDING.slug));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  window.addEventListener('load', () => {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloading) {
        reloading = true;
        window.location.reload();
      }
    });
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
