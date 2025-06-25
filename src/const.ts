import type {
  AppCache,
  AppSettings,
  GlobalFlags,
  GlobalData,
  GlobalServices,
  PrivateCache
} from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json '}

export { SYMBOLS }

export const DB_NAME     = 'frostr-pwa'
export const DB_VERSION  = 1
export const BUS_TIMEOUT = 5000
export const LOG_LIMIT   = 100

export const APP_CACHE : AppCache = {
  sessions : []
}

export const APP_SETTINGS : AppSettings = {
  group    : null,
  peers    : [],
  pubkey   : null,
  relays   : [],
  share    : null
}

export const GLOBAL_SERVICES : GlobalServices = {
  cache    : null,
  core     : null,
  log      : null,
  node     : null,
  rpc      : null,
  settings : null
}

export const GLOBAL_DATA : GlobalData = {
  flags   : { debug : false, verbose : true },
  private : { share : null }
}
