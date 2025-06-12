/// <reference lib="webworker" />

import { parse_message } from '@/lib/message.js'
import { parse_error }   from '@/util/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json' }

const BIFROST_TOPICS = Object.values(SYMBOLS.CLIENT.BIFROST)
const LOG_TOPICS     = Object.values(SYMBOLS.LOG)
const SESSION_TOPICS = Object.values(SYMBOLS.CLIENT.SESSION)
const STORE_TOPICS   = [
  ...Object.values(SYMBOLS.STORE.BIFROST),
  ...Object.values(SYMBOLS.STORE.SESSION)
]

// Declare the service worker global scope
declare const self: ServiceWorkerGlobalScope

// Register service worker
self.addEventListener('install', (_event) => {
  console.log('[ sw ] installing...')
  // TODO: Initialize our services here.
  // Initialize the bifrost services.
  // Initialize the session services.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[ sw ] activating...')
  event.waitUntil(self.clients.claim())
})

/**
 * Listen for messages from clients.
 */
self.addEventListener('message', (event) => {
  // Parse the message.
  const message = parse_message(event.data)
  // Ensure we have a valid message
  if (!message) {
    console.error('[ sw ] received invalid message:', event.data)
    return
  }
  // If the message is a response, do not handle it.
  if (message.type === 'response') return
  // Handle the message.
  try {
    if (BIFROST_TOPICS.includes(message.topic)) {
      // Handle bifrost messages.
    } else if (SESSION_TOPICS.includes(message.topic)) {
      // Handle session messages.
    } else if (LOG_TOPICS.includes(message.topic)) {
      // Handle log messages.
    } else if (STORE_TOPICS.includes(message.topic)) {
      // Handle store messages.
    } else {
      console.error('[ sw ] unknown message topic:', message.topic)
    }
  } catch (err) {
    console.error('[ sw ] error handling message: ' + parse_error(err))
    console.error(message)
    console.error(err)
  }
})
