import { createRoot } from 'react-dom/client';
import OptionsApp from './OptionsApp.js';
import '../popup/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Options root element was not found');
}

createRoot(root).render(<OptionsApp />);
