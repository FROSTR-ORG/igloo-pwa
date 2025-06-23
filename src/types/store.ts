import type { GroupPackage, PeerConfig, SharePackage } from '@frostr/bifrost'

import type { SessionToken } from '@cmdcode/nostr-connect'
import type { RelayPolicy }  from './app.js'

export type StoreData          = Record<string, any>
export type StoreMiddleware<T> = (current : T, updated : T) => Promise<T> | T

export interface StoreTopics {
  EVENT  : string
  FETCH  : string
  UPDATE : string
  RESET  : string
}

export interface StoreConfig <T extends StoreData> {
  defaults   : T
  store_key  : string
  topics     : StoreTopics
  validator? : (data : unknown) => asserts data is T
}

export interface ApplicationCache {
  sessions : SessionToken[]
}

export interface ApplicationSettings {
  group    : GroupPackage | null
  peers    : PeerConfig[]
  pubkey   : string | null
  relays   : RelayPolicy[]
  share    : string | null
}

export interface PrivateStore {
  share : SharePackage | null
}
