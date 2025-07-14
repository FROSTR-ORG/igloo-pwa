import { GlobalController }  from '@/core/global.js'
import { ConsoleController } from '@/services/console.js'
import { BifrostController } from '@/services/node/class.js'
import { SignerController }  from '@/services/signer/class.js'

import {
  GLOBAL_INIT_STATE,
  GLOBAL_SERVICES
} from '@/const.js'

import { 
  create_cache_store,
  create_settings_store
} from '@/services/store/create.js'

import type {
  GlobalInitScope,
  GlobalStateKey
} from '@/types/index.js'

import { RequestController } from '@/services/request/class'
import { SessionController } from '@/services/session/class'

export function init_global_state (scope : any) {
  // For each key in the global defaults,
  for (const key in GLOBAL_INIT_STATE) {
    // If the key is not in the state,
    if (scope[key] === undefined) {
      // Set the key to the default value.
      scope[key] = GLOBAL_INIT_STATE[key as GlobalStateKey]
    }
  }
}

export function init_global_services (scope : GlobalInitScope) {
  // Create a new global controller.
  scope.global = new GlobalController(scope)
  // Create new global services.
  scope.service = {
    cache    : create_cache_store(scope),
    console  : new ConsoleController(scope),
    node     : new BifrostController(scope),
    signer   : new SignerController(scope),
    request  : new RequestController(scope),
    session  : new SessionController(scope),
    settings : create_settings_store(scope)
  }
}

export function start_global_services (scope : any) {
  // For each key in the global defaults,
  for (const key in GLOBAL_SERVICES) {
    // If the key is not in the state,
    if (typeof scope?.service?.[key] === 'object') {
      if (typeof scope?.service?.[key]?.['init'] === 'function') {
        scope.service[key]['init']()
      }
    }
  }
}