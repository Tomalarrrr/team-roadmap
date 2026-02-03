import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { AccessGate } from './components/AccessGate'
import './index.css'
import App from './App.tsx'

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
