/// <reference lib="webworker" />

import { create_logger }     from '@vbyte/micro-lib/logger'
import { CoreController }    from '@/core/ctrl.js'
import { ConsoleController } from '@/services/console.js'
import { BifrostController } from '@/services/node/class.js'
import { RpcController }     from '@/services/rpc/class.js' 
import * as CONST            from '@/const.js'

import { 
  create_cache_store,
  create_settings_store
} from '@/services/store/create.js'

import type {
  GlobalInitScope,
  GlobalStateKey
} from '@/types/index.js'
import { sleep } from '@vbyte/micro-lib/util'

const GLOBAL_DATA     = CONST.GLOBAL_DATA
const GLOBAL_SERVICES = CONST.GLOBAL_SERVICES
const GLOBAL_STATE    = { ...GLOBAL_DATA, ...GLOBAL_SERVICES }

// Declare the service worker global scope
declare const self : GlobalInitScope

const log = create_logger('sw')

// Register service worker
self.addEventListener('install', async (_event) => {
  log.info('installing ...')
  // Initialize the global values.
  init_global_values(self)
  // Log the global state initialization.
  log.info('global state initialized')
  // Create the global services.
  create_global_services(self)
  // Log the global services initialization.
  log.info('global services installed')
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Log the activate event.
  console.log('[ sw ] activating ...')
  // Initialize the global services.
  init_global_services(self)
  // Log the global services initialization.
  log.info('global services activated')
  // Skip waiting for the service worker to become active.
  self.skipWaiting()
})

self.addEventListener('message', async (event) => {
  if (!self.core) { 
    log.info('initializing service worker ...')
    init_service_worker(self)
    await sleep(5000)
    log.info('service worker initialized')
  }
  self.core?.mbus.handle(event)
})

function init_service_worker (scope : any) {
  init_global_values(scope)
  create_global_services(scope)
  init_global_services(scope)
}

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
  scope.core     ??= new CoreController(scope)
  scope.log      ??= new ConsoleController(scope)
  scope.node     ??= new BifrostController(scope)
  scope.rpc      ??= new RpcController(scope)
  scope.cache    ??= create_cache_store(scope)
  scope.settings ??= create_settings_store(scope)
}

function init_global_services (scope : any) {
  // For each key in the global defaults,
  for (const key in GLOBAL_SERVICES) {
    // If the key is not in the state,
    if (typeof scope[key] === 'object') {
      if (typeof scope[key]['init'] === 'function') {
        scope[key]['init']()
      }
    }
  }
}