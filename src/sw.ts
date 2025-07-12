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

self.addEventListener('activate', (_event) => {
  // Log the activate event.
  console.log('[ sw ] activating ...')
  // Initialize the global services.
  start_global_services(self)
  // Log the global services initialization.
  LOG.info('global services activated')
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
})

self.addEventListener('message', async (event) => {
  Assert.exists(self.global, 'message received before global is initialized')
  self.global.mbus.handler(event)
})
