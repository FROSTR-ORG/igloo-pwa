import { GlobalController }  from '@/core/global.js'
import { ConsoleController } from '@/services/console.js'
import { BifrostController } from '@/services/node/class.js'
import { SignerController }  from '@/services/signer/class.js' 
import * as CONST            from '@/const.js'

import { 
  create_cache_store,
  create_settings_store
} from '@/services/store/create.js'

import type {
  GlobalInitScope,
  GlobalStateKey
} from '@/types/index.js'

const GLOBAL_DATA     = CONST.GLOBAL_DATA
const GLOBAL_SERVICES = CONST.GLOBAL_SERVICES
const GLOBAL_STATE    = { ...GLOBAL_DATA, ...GLOBAL_SERVICES }

export function init_global_state (scope : any) {
  // For each key in the global defaults,
  for (const key in GLOBAL_STATE) {
    // If the key is not in the state,
    if (scope[key] === undefined) {
      // Set the key to the default value.
      scope[key] = GLOBAL_STATE[key as GlobalStateKey]
    }
  }
}


export function init_global_services (scope : GlobalInitScope) {
  scope.global   ??= new GlobalController(scope)
  scope.console  ??= new ConsoleController(scope)
  scope.node     ??= new BifrostController(scope)
  scope.signer   ??= new SignerController(scope)
  scope.cache    ??= create_cache_store(scope)
  scope.settings ??= create_settings_store(scope)
}

export function start_global_services (scope : any) {
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