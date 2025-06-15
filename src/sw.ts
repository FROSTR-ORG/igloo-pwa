/// <reference lib="webworker" />

import { parse_message }  from '@/lib/message.js'
import { parse_error }    from '@/util/index.js'
import { ClientService }  from '@/services/client.js'
import { DBController }   from '@/core/db.js'
import { SessionService } from '@/services/session.js'
import { StoreService }   from '@/services/settings.js'

import * as CONST from '@/const.js'

const STORE_KEY      = CONST.STORE_KEY
const STORE_DEFAULT  = CONST.DEFAULT_STORE
const TOPICS         = CONST.SYMBOLS.TOPICS

// Declare the service worker global scope
declare const self: ServiceWorkerGlobalScope

// Register service worker
self.addEventListener('install', async (_event) => {
  console.log('[ sw ] installing...')
  await DBController.init(STORE_KEY, STORE_DEFAULT)
  ClientService.register()
  SessionService.register()
  StoreService.register()
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('[ sw ] activating...')
  event.waitUntil(self.clients.claim())
})

/**
 * Listen for requests from clients.
 */
self.addEventListener('message', (event) => {
  console.log('[ sw ] received message:', event.data)
  try {
    // Parse the message.
    const message = parse_message(event.data)
    // Ensure we have a valid message
    if (!message) throw new Error('message failed validation')
    
    // Handle request messages
    if (message.type === 'request') {
      // Parse the message topic.
      const topic = message.topic.split('.').at(0) ?? 'NULL'
      // Handle the message based on the topic.
      switch (topic) {
        case TOPICS.CLIENT:
          // Handle bifrost messages.
          ClientService.handler(message)
          break
        case TOPICS.LOG:
          // Handle log messages.
          break
        case TOPICS.SESSION:
          // Handle session messages.
          SessionService.handler(message)
          break
        case TOPICS.STORE:
          StoreService.handler(message)
          break
        default:
          console.error('[ sw ] unknown message topic:', topic)
      }
    }
    // Event messages are handled by the MessageBus subscriptions
  } catch (err) {
    console.error('[ sw ] error handling message: ' + parse_error(err))
  }
})
