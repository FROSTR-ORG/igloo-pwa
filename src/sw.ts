/// <reference lib="webworker" />

import { Assert } from '@vbyte/micro-lib'
import { logger } from '@/logger.js'

import {
  init_global_state,
  init_global_services,
  start_global_services
} from '@/lib/init.js'

import type { GlobalInitScope } from '@/types/index.js'

// Declare the service worker global scope
declare const self : GlobalInitScope

const LOG = logger('sw')

// Register service worker
self.addEventListener('install', async (_event) => {
  LOG.info('installing ...')
  // Initialize the global values.
  init_global_state(self)
  // Log the global state initialization.
  LOG.info('global state initialized')
  // Create the global services.
  init_global_services(self)
  // Log the global services initialization.
  LOG.info('global services installed')
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Log the activate event.
  console.log('[ sw ] activating ...')
  // Initialize the global services.
  start_global_services(self)
  // Log the global services initialization.
  LOG.info('global services activated')
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
  
  // Set up periodic background sync for connection health
  event.waitUntil(
    (async () => {
      try {
        // Register periodic background sync if available
        if ('sync' in self.registration) {
          // @ts-ignore - sync types are not fully defined
          await self.registration.sync.register('keep-alive-sync')
          LOG.info('background sync registered')
        }
        
        // Set up periodic sync for connection health check
        if ('periodicSync' in self.registration) {
          // @ts-ignore - periodicSync is experimental
          await self.registration.periodicSync.register('connection-health-check', {
            minInterval: 60000 // Check every minute
          })
          LOG.info('periodic sync registered')
        }
      } catch (err) {
        LOG.warn('background sync registration failed:', err)
      }
    })()
  )
})

self.addEventListener('message', async (event) => {
  if (self.global === undefined) {
    init_global_state(self)
    init_global_services(self)
    start_global_services(self)
  }
  Assert.exists(self.global, 'message received before global is initialized')
  self.global.mbus.handler(event)
})

// Handle background sync events
self.addEventListener('sync', (event: any) => {
  LOG.info('background sync event:', event.tag)
  
  if (event.tag === 'keep-alive-sync') {
    event.waitUntil(
      (async () => {
        try {
          // Check if we have a node connection and try to reconnect if needed
          if (self.global?.service?.node) {
            const nodeService = self.global.service.node
            if (nodeService.isVisible && !nodeService.is_ready) {
              LOG.info('attempting reconnection from background sync')
              nodeService.attemptReconnection()
            }
          }
        } catch (err) {
          LOG.error('background sync failed:', err)
        }
      })()
    )
  }
})

// Handle periodic sync events (experimental)
self.addEventListener('periodicsync', (event: any) => {
  LOG.info('periodic sync event:', event.tag)
  
  if (event.tag === 'connection-health-check') {
    event.waitUntil(
      (async () => {
        try {
          // Health check for connections
          if (self.global?.service?.node) {
            const nodeService = self.global.service.node
            if (nodeService.client && !nodeService.client.is_ready) {
              LOG.info('periodic health check detected dead connection')
              if (nodeService.isVisible) {
                nodeService.attemptReconnection()
              }
            }
          }
        } catch (err) {
          LOG.error('periodic sync health check failed:', err)
        }
      })()
    )
  }
})

// Handle push events for wake-up scenarios
self.addEventListener('push', (event) => {
  LOG.info('push event received')
  
  event.waitUntil(
    (async () => {
      try {
        // Wake up the connection if needed
        if (self.global?.service?.node) {
          const nodeService = self.global.service.node
          if (!nodeService.is_ready && nodeService.can_start) {
            LOG.info('waking up connection from push event')
            nodeService.start()
          }
        }
      } catch (err) {
        LOG.error('push event handling failed:', err)
      }
    })()
  )
})
