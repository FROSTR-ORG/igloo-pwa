export const DB_NAME    = 'igloo-pwa'
export const DB_VERSION = 1

export const BUS_TIMEOUT = 5000

export const NOSTR_MSG_TYPE = {
  GET_PUBLIC_KEY : 'nostr.getPublicKey',
  GET_RELAYS     : 'nostr.getRelays',
  SIGN_EVENT     : 'nostr.signEvent',
  NIP04_ENCRYPT  : 'nostr.nip04.encrypt',
  NIP04_DECRYPT  : 'nostr.nip04.decrypt',
  NIP44_ENCRYPT  : 'nostr.nip44.encrypt',
  NIP44_DECRYPT  : 'nostr.nip44.decrypt',
  GET_ACCOUNT    : 'nostr.getAccount' 
} as const

export const SYSTEM_MESSAGE_TYPE = {
  STORE_UPDATE : 'store.update',
  NODE_RESET   : 'node.reset',
  NODE_STATUS  : 'node.status',
  URL_REPLACE  : 'url.replace'
} as const

export const MESSAGE = {
  CONNECT       : 'CONNECT',
  DISCONNECT    : 'DISCONNECT',
  SAVE_SETTINGS : 'SAVE_SETTINGS',
  LOAD_SETTINGS : 'LOAD_SETTINGS',
  SIGN_REQUEST  : 'SIGN_REQUEST',
  SIGN_RESPONSE : 'SIGN_RESPONSE',
  ERROR         : 'ERROR',
}

export const MESSAGE_TYPE = {
  ...SYSTEM_MESSAGE_TYPE,
  ...NOSTR_MSG_TYPE,
  ...MESSAGE
} as const

export const PERMISSION_BYPASS : Record<string, boolean> = {
  [MESSAGE_TYPE.STORE_UPDATE] : true,
  [MESSAGE_TYPE.NODE_RESET]   : true,
  [MESSAGE_TYPE.NODE_STATUS]  : true,
  [MESSAGE_TYPE.URL_REPLACE]  : true
} as const

export const POLICY_DOMAIN = {
  NOSTR   : 'nostr',
  BITCOIN : 'bitcoin'
} as const

export const STORE = {
  SETTINGS   : 'SETTINGS',
  SIGNATURES : 'SIGNATURES',
}
