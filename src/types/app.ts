import type { PeerData } from '@frostr/bifrost'

import type {
  PermissionRequest,
  SignerSession
} from '@cmdcode/nostr-connect'

export interface BifrostState {
  peers  : PeerData[]
  pubkey : string | null
  status : string
}

export interface SignerState {
  status : string
}

export interface RequestState {
  queue : PermissionRequest[]
}

export interface SessionState {
  active  : SignerSession[]
  pending : SignerSession[]
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
