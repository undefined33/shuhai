import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SidePanelApp from './SidePanelApp.js';
import '../popup/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanelApp />
  </StrictMode>,
);
