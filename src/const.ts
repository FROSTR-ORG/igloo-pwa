import type {
  ApplicationCache,
  ApplicationSettings,
  GlobalFlags,
  GlobalData,
  GlobalServices
} from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json '}

export { SYMBOLS }

export const FLAGS : GlobalFlags = {
  debug   : false,
  verbose : true
}

export const DB_NAME     = 'frostr-pwa'
export const DB_VERSION  = 1
export const BUS_TIMEOUT = 5000
export const LOG_LIMIT   = 100

export const APP_CACHE : ApplicationCache = {
  sessions : []
}

export const APP_SETTINGS : ApplicationSettings = {
  group    : null,
  peers    : [],
  pubkey   : null,
  relays   : [],
  share    : null
}

export const GLOBAL_SERVICES : GlobalServices = {
  cache    : null,
  ctrl     : null,
  log      : null,
  enclave  : null,
  node     : null,
  rpc      : null,
  settings : null
}

export const GLOBAL_DATA : GlobalData = {
  flags   : FLAGS,
  private : null,
}
