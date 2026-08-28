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
