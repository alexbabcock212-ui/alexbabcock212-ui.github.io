import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { registerServiceWorker } from './data/serviceWorker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App userName="Alex" startTab="today" />
  </StrictMode>,
)

registerServiceWorker()
