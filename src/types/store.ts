import { SessionToken } from '@cmdcode/nostr-connect'

import {
  GroupPackage,
  PeerConfig
} from '@frostr/bifrost'

export interface ClientStore {
  group    : GroupPackage | null
  peers    : PeerConfig[]
  pubkey   : string | null
  relays   : RelayPolicy[]
  sessions : SessionToken[]
  share    : string | null
}

export interface PeerPolicy {
  pubkey : string
  send   : boolean
  recv   : boolean
}

export interface RelayPolicy {
  url   : string
  read  : boolean
  write : boolean
}
