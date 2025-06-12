import { GroupPackage, PeerConfig, SharePackage } from '@frostr/bifrost'

export type BifrostNodeStatus = 'online' | 'offline' | 'locked'

export interface BifrostInfo {
  status : string
  peers  : string[]
  pubkey : string
}

export interface BifrostStore {
  group  : GroupPackage | null
  peers  : PeerConfig[]
  relays : RelayPolicy[]
  share  : SharePackage | null
}

export interface PeerStatus {
  pubkey  : string
  status  : 'online' | 'offline' | 'checking'
  updated : number
}

export interface RelayPolicy {
  url   : string
  read  : boolean
  write : boolean
}
