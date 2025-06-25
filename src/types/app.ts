import type { SessionToken } from '@cmdcode/nostr-connect'
import type { PeerData }     from '@frostr/bifrost'

export interface NodeState {
  peers  : PeerData[]
  pubkey : string | null
  status : string
}

export interface SessionState {
  active  : SessionToken[]
  pending : SessionToken[]
  status  : string
}

export interface PeerPolicy {
  pubkey : string
  send   : boolean
  recv   : boolean
}

export interface PermRequest {
  content? : unknown
  id       : string
  source   : string
  method   : string
}

export interface RelayPolicy {
  url   : string
  read  : boolean
  write : boolean
}
