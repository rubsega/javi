import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = document.getElementById('root');
// Inside the Polkadot App there is no console: show the crash instead of a black screen.
createRoot(root, {
  onUncaughtError: (e) => {
    root.innerHTML = '<pre style="white-space:pre-wrap;padding:16px;color:#fff;background:#600"></pre>';
    root.firstChild.textContent = `Error (build ${__BUILD__}):\n${e?.stack ?? e}`;
  },
}).render(<App />);
