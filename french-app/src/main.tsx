import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { VocabProvider } from './storage/RepoContext'
import './styles/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <VocabProvider>
        <App />
      </VocabProvider>
    </HashRouter>
  </StrictMode>,
)
