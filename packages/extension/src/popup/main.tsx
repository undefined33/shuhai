import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Popup root element was not found');
}

createRoot(root).render(<App />);
