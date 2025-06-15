import type { ClientStore, ClientState, SessionStore } from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json '}

export { SYMBOLS }

export const DB_NAME     = 'frostr-pwa'
export const DB_VERSION  = 1
export const BUS_TIMEOUT = 5000
export const LOG_LIMIT   = 100

export const STORE_KEY    = 'store'

export const DEFAULT_SESSION : SessionStore = {
  active  : [],
  pending : []
}

export const DEFAULT_STATE : ClientState = {
  peers    : [],
  pubkey   : null,
  requests : [],
  status   : 'loading'
}

export const DEFAULT_STORE : ClientStore = {
  group    : null,
  peers    : [],
  pubkey   : null,
  relays   : [],
  sessions : [],
  share    : null
}
