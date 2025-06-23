/// <reference lib="webworker" />

import * as CONST            from '@/const.js'
import { GlobalController }  from '@/core/global.js'
import { EnclaveController } from '@/services/enclave.js'
import { LogController }     from '@/services/logger.js'
import { BifrostController } from '@/services/node.js'
import { RpcController }     from '@/services/rpc.js'

import {
  init_cache_store,
  init_settings_store
} from '@/lib/store.js'

import type {
  GlobalInitScope,
  GlobalStateKey
} from '@/types/index.js'

const GLOBAL_DATA     = CONST.GLOBAL_DATA
const GLOBAL_SERVICES = CONST.GLOBAL_SERVICES
const GLOBAL_STATE    = { ...GLOBAL_DATA, ...GLOBAL_SERVICES }

// Declare the service worker global scope
declare const self : GlobalInitScope

// Register service worker
self.addEventListener('install', async (_event) => {
  console.log('[ sw ] installing ...')
  // Initialize the global values.
  init_global_values(self)
  // Create the global services.
  create_global_services(self)
  // Initialize the global services.
  init_global_services(self)
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Log the activate event.
  console.log('[ sw ] activating ...')
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
})

self.addEventListener('message', (event) => {
  console.log('[ sw ] received message:', event.data)
})

function init_global_values (scope : any) {
  // For each key in the global defaults,
  for (const key in GLOBAL_STATE) {
    // If the key is not in the state,
    if (scope[key] === undefined) {
      // Set the key to the default value.
      scope[key] = GLOBAL_STATE[key as GlobalStateKey]
    }
  }
}

function create_global_services (scope : GlobalInitScope) {
  scope.ctrl     ??= new GlobalController(scope)
  scope.enclave  ??= new EnclaveController(scope)
  scope.log      ??= new LogController(scope)
  scope.node     ??= new BifrostController(scope)
  scope.rpc      ??= new RpcController(scope)
  scope.cache    ??= init_cache_store(scope)
  scope.settings ??= init_settings_store(scope)
}

function init_global_services (scope : any) {
  // For each key in the global defaults,
  for (const key in GLOBAL_SERVICES) {
    // If the key is not in the state,
    if (
      typeof scope[key] === 'object' &&
      typeof scope[key].init === 'function'
    ) {
      // Run the init function.
      scope[key].init()
    }
  }
}