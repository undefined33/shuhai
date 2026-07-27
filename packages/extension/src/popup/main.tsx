import { createRoot } from 'react-dom/client';
import PopupApp from './PopupApp.js';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Popup root element was not found');
}

createRoot(root).render(<PopupApp />);
