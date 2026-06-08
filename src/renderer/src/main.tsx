import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// NOTE: no React.StrictMode — TerminalView manages imperative PTY/xterm resources
// and StrictMode's double-mount would spawn then kill shells in dev.
createRoot(document.getElementById('root')!).render(<App />)
