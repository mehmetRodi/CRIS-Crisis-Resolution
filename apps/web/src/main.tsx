import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Side-effect import: configures Amplify from amplify_outputs.json before render.
import './lib/amplify';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
