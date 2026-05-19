
import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { installConsoleEasterEgg } from './app/consoleEasterEgg';
import './styles/index.css';

installConsoleEasterEgg();

createRoot(document.getElementById('root')!).render(<App />);
