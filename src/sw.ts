/// <reference lib="webworker" />

import { handle_message } from '@/bus/server.js'

// Declare the service worker global scope
declare const self: ServiceWorkerGlobalScope

// Register service worker
self.addEventListener('install', (_event) => {
  console.log('[ sw ] installing...')
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[ sw ] activating...')
  event.waitUntil(self.clients.claim())
})

// Listen for messages from clients
self.addEventListener('message', (event) => {
  
  // Ensure we have a valid message
  if (!event.data || typeof event.data !== 'object') {
    console.error('[ sw ] received invalid message:', event.data)
    return
  }

  try {
    handle_message(event.data)
  } catch (error) {
    console.error('[ sw ] error parsing message:')
    console.error(error)
  }
})
