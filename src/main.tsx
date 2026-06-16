import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { AccessGate } from './components/AccessGate'
import './index.css'
import App from './App.tsx'

// Pause continuous CSS animations while the tab is backgrounded (see the
// [data-tab-hidden] rule in index.css). Saves CPU/battery on machines that keep
// compositing hidden or secondary-window tabs.
const syncTabHidden = () => {
  document.documentElement.dataset.tabHidden = String(document.hidden)
}
document.addEventListener('visibilitychange', syncTabHidden)
syncTabHidden()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AccessGate>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AccessGate>
    </ErrorBoundary>
  </StrictMode>,
)
