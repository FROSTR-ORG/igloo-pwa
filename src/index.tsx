import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App }        from '@/components/app.js'
import { create_request_message } from '@/lib/message.js'
import { SYMBOLS }                from '@/const.js'

import { 
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'

import './styles/global.css'
import './styles/layout.css'
import './styles/node.css'
import './styles/console.css'
import './styles/sessions.css'
import './styles/requests.css'
import './styles/settings.css'
import './styles/scanner.css'

const DOMAIN = SYMBOLS.DOMAIN.APP
const TOPIC  = SYMBOLS.TOPIC.APP

// Create a client instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
})

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // Configure the service worker options.
      const options = { scope: './' }
      // Register the service worker.
      const worker  = await navigator.serviceWorker.register('./sw.js', options)
      // If the worker is not active, throw an error.
      if (!worker.active) throw new Error('[ app ] worker returned null')
      // Create the initialization message.
      const msg = create_request_message({ domain: DOMAIN, topic: TOPIC.INIT })
      // Send initialization message to service worker.
      worker.active.postMessage(msg)
      // Also handle service worker updates
      worker.addEventListener('updatefound', () => {
        // Get the updated worker.
        const updated = worker.installing
        // If the updated worker is not found, throw an error.
        if (!updated) throw new Error('[ app ] worker returned null')
        // Listen for state changes.
        updated.addEventListener('statechange', () => {
          // If the updated worker is activated,
          if (updated.state === 'activated') {
            // Send initialization message.
            updated.postMessage(msg)
          }
        })
      })
      console.log('[ app ] worker registered with scope:', worker.scope)
    } catch (error) {
      console.error('[ app ] worker registration failed:', error)
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
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
