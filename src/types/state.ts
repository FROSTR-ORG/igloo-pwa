import type { PeerData } from '@frostr/bifrost'

export type ClientStatus = 'online' | 'connecting' | 'locked' | 'offline' | 'loading'
export type LogType      = 'info' | 'error' | 'warning' | 'success' | 'sign' | 'req' | 'res' | 'ready'

export interface LogEntry {
  timestamp : number
  message   : string
  type      : string
  payload?  : any
}

export interface PermRequest {
  content? : unknown
  id       : string
  source   : string
  method   : string
}

export interface ClientState {
  peers    : PeerData[]
  pubkey   : string | null
  requests : PermRequest[]
  status   : ClientStatus
}
