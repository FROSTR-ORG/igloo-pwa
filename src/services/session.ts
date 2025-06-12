import { SessionClient, SessionToken } from '@cmdcode/nostr-connect'

import { DBController }   from '@/services/db.js'
import { BifrostService } from '@/services/node.js'

let _client : SessionClient | null = null

interface SessionStore {
  relays   : string[]
  sessions : SessionToken[]
}

export namespace SessionService {
  export const init = init_client
  export const get  = get_client
}

export async function init_client () {
  const store   = await DBController.load<SessionStore>('session')
  if (!can_init(store)) return
  const signer  = await BifrostService.get_signer()
  if (!signer) return
  const pubkey  = await signer.get_pubkey()
  _client = new SessionClient(pubkey, signer,{ sessions: store.sessions })
}

export function get_client () {
  if (!_client) init_client()
  return _client
}

export function can_init (store : SessionStore | null) : store is SessionStore {
  return !!store && !!store.relays && store.relays.length > 0
}
