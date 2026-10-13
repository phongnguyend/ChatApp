import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppDialogs } from './components/AppDialogs'
import { applyTheme, getThemePreference } from './theme'

applyTheme(getThemePreference())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AppDialogs />
  </StrictMode>,
)
