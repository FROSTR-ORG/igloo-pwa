import type { SessionToken } from '@cmdcode/nostr-connect'

export interface SessionStore {
  active  : SessionToken[]
  pending : SessionToken[]
}
