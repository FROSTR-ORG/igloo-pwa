
import { BifrostSigner } from '@/class/signer.js'
import { DBController }  from '@/services/db.js'

import {
  BifrostNode,
  GroupPackage,
  PeerPolicy,
  SharePackage
} from '@frostr/bifrost'

let _client : BifrostNode   | null = null
let _signer : BifrostSigner | null = null

interface BifrostStore {
  group  : GroupPackage
  policy : PeerPolicy
  relays : string[]
  share  : SharePackage
}

export namespace BifrostService {
  export const init       = init_clients
  export const get_node   = get_node_client
  export const get_signer = get_signer_client
}

export async function init_clients () {
  const store = await DBController.load<BifrostStore>('bifrost')

  if (!can_init(store)) return

  _client = new BifrostNode(store.group, store.share, store.relays)
  _signer = new BifrostSigner(_client)
}

export async function get_node_client () {
  if (!_client) await init_clients()
  return _client
}

export async function get_signer_client () {
  if (!_signer) await init_clients()
  return _signer
}

export function can_init (store : BifrostStore | null) : store is BifrostStore {
  return !!store && !!store.group && !!store.share && store.relays.length > 0
}
