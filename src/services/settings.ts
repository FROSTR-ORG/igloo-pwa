import { DBController }          from '@/core/db.js'
import { MessageBus }            from '@/core/mbus.js'
import { parse_error }           from '@/util/index.js'
import { validate_store_data, validate_store_update } from '@/lib/validate.js'
import * as CONST                from '@/const.js'

import type { ClientStore, RequestMessage } from '@/types/index.js'

const STORE_ACTION  = CONST.SYMBOLS.STORE
const STORE_KEY     = CONST.STORE_KEY
const STORE_DEFAULT = CONST.DEFAULT_STORE

export namespace StoreService {
  export const register = register_store_service
  export const handler  = handle_store_message
}

function register_store_service () {
  DBController.subscribe(CONST.STORE_KEY, (data) => {
    MessageBus.send({
      topic   : STORE_ACTION.EVENT,
      payload : data
    })
  })
}

async function handle_store_message (message: RequestMessage) {
  try {
    switch (message.topic) {
      case STORE_ACTION.FETCH:
        fetch_store(message)
        break
      case STORE_ACTION.UPDATE:
        update_store(message)
        break
      case STORE_ACTION.RESET:
        reset_store(message)
        break
    }
  } catch (err) {
    MessageBus.reject(message.id, parse_error(err))
  }
}

async function fetch_store (message: RequestMessage) {
  const current = await DBController.load(STORE_KEY)
  MessageBus.respond(message.id, current)
}

async function update_store (message: RequestMessage) {
  // Load the current store.
  const current = await DBController.load(STORE_KEY)
  // If the current store is invalid, return an error response.
  if (!validate_store_data(current)) {
    MessageBus.reject(message.id, 'invalid store data')
    return
  }
  // If the store update message is invalid,
  if (!validate_store_update(message.params)) {
    // Return an error response.
    MessageBus.reject(message.id, 'invalid settings')
    return
  }
  // Merge the current store with the updated store.
  const updated = { ...current ?? {}, ...message.params }
  // If the peers need to be initialized,
  if (should_init_peers(current, message.params)) {
    // Initialize the peer permissions.
    updated.peers = init_peer_permissions(updated)
  }
  // Save the updated store.
  await DBController.save(STORE_KEY, updated)
  // Respond with the result.
  MessageBus.respond(message.id, true)
}

async function reset_store (message: RequestMessage) {
  await DBController.save(STORE_KEY, STORE_DEFAULT)
  MessageBus.respond(message.id, true)
}

function should_init_peers (
  current : ClientStore,
  changes : Partial<ClientStore>
) {
  // If the group or share has changed, return true.
  if (changes.group || changes.pubkey) return true
  // If the group has been reset, return true.
  if (current.group && changes.group === null) return true
  // If the share has been reset, return true.
  if (current.pubkey && changes.pubkey === null) return true
  // If the group and pubkey are set, and the peers are not set, return true.
  if (current.group && current.pubkey && current.peers.length === 0) return true
  // If there is no group set, and the peers are set, return true.
  if (!current.group && !changes.group && current.peers.length > 0) return true
  // If there is no pubkey set, and the peers are set, return true.
  if (!current.pubkey && !changes.pubkey && current.peers.length > 0) return true
  // Otherwise, return false.
  return false
}

function init_peer_permissions (store : ClientStore) {
  // Unpack the store.
  const { group, pubkey } = store
  // If the group or pubkey is not set, return an empty array.
  if (!group || !pubkey) return []
  // Initialize the peer permissions.
  return group.commits
    .filter((commit) => commit.pubkey !== pubkey)
    .map(commit => ({
      pubkey : commit.pubkey,
      policy : { send : true, recv : true }
    }))
}
