import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../popup/App.js';
import '../popup/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App surface="sidepanel" />
  </StrictMode>,
);
