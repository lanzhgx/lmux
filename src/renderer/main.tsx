import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@xterm/xterm/css/xterm.css'
import 'allotment/dist/style.css'
import './styles.css'

// No StrictMode: its double-invoked effects would create/dispose ptys twice.
createRoot(document.getElementById('root')!).render(<App />)
