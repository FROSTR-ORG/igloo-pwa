import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import './styles/global.css'

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      })
      console.log('[ app ] service worker registered with scope:', registration.scope)
    } catch (error) {
      console.error('[ app ] service worker registration failed:', error)
    }
  })
}

// Fetch the root container.
const container = document.getElementById('root')

// If the root container is not found, throw an error.
if (!container) throw new Error('[ app ] root container not found')

// Create the react root element.
const root = createRoot(container)

// Render the app.
root.render(
  <StrictMode>
    <App />
  </StrictMode>
)
