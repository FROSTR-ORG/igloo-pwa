import type {
  AppCache,
  AppSettings,
  GlobalInitState,
  GlobalServicesInit
} from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json '}

export { SYMBOLS }

export const CACHE_NAME  = 'frostr-pwa'
export const DB_NAME     = 'frostr-pwa'
export const DB_VERSION  = 2
export const BUS_TIMEOUT = 5000
export const LOG_LIMIT   = 100

export const DISPATCH_TIMEOUT = 100

export const APP_CACHE : AppCache = {
  sessions : []
}

export const APP_SETTINGS : AppSettings = {
  group         : null,
  notifications : false,
  peers         : [],
  pubkey        : null,
  relays        : [],
  share         : null
}

export const GLOBAL_SERVICES : GlobalServicesInit = {
  cache    : null,
  console  : null,
  node     : null,
  request  : null,
  session  : null,
  settings : null,
  signer   : null
}

export const GLOBAL_INIT_STATE : GlobalInitState = {
  flags   : { debug : false, verbose : true },
  global  : null,
  private : { share : null },
  service : GLOBAL_SERVICES
}
