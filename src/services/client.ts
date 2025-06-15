import { BifrostNode, SharePackage } from '@frostr/bifrost'

import { DBController }        from '@/core/db.js'
import { MessageBus }          from '@/core/mbus.js'
import { decrypt_secret }      from '@/lib/crypto.js'
import { decode_share }        from '@/lib/encoder.js'
import { JsonUtil }            from '@/util/index.js'
import * as CONST              from '@/const.js' 

import type {
  ClientStore,
  ClientState,
  ClientStatus,
  RequestMessage,
  LogType,
  LogEntry
} from '@/types/index.js'

interface GlobalClientState {
  info   : ClientState
  logs   : LogEntry[]
  node   : BifrostNode   | null
  share  : SharePackage  | null
  store  : ClientStore
}

const CLIENT_ACTION    = CONST.SYMBOLS.CLIENT
const DEFAULT_STATE    = CONST.DEFAULT_STATE
const DEFAULT_STORE    = CONST.DEFAULT_STORE
const LOG_LIMIT        = 100
const STORE_KEY        = CONST.STORE_KEY

let _global : GlobalClientState = {
  info  : DEFAULT_STATE,
  logs  : [],
  node  : null, 
  share : null,
  store : DEFAULT_STORE,
}

export namespace ClientService {
  export const init     = init_node
  export const get      = get_client
  export const handler  = handle_client_message
  export const register = register_client_service
}

function register_client_service () {
  // Subscribe to store updates.
  subscribe_to_store()
  // Initialize the store.
  init_store()
  // Update the client info.
  update_client_info()
}

function handle_client_message (msg : RequestMessage) {
  switch (msg.topic) {
    // For fetch requests,
    case CLIENT_ACTION.FETCH: {
      // Update the client info.
      update_client_info()
      // Respond with the latest info.
      MessageBus.respond(msg.id, _global.info)
      // Break.
      break
    }
    // For ping requests,
    case CLIENT_ACTION.ECHO: {
      // If the client is not initialized, return an error.
      if (!_global.node) {
        MessageBus.reject(msg.id, 'client not initialized')
        break
      }
      // Ping the peer.
      _global.node.req.echo(msg.params as string).then(res => {
        // If the ping failed, return an error.
        if (!res.ok) {
          MessageBus.reject(msg.id, res.err)
          return
        }
        // Respond with the result.
        MessageBus.respond(msg.id, true)
      })
      // Break.
      break
    }
    // For ping requests,
    case CLIENT_ACTION.PING: {
      // If the client is not initialized, return an error.
      if (!_global.node) {
        MessageBus.reject(msg.id, 'client not initialized')
        break
      }
      // Ping the peer.
      _global.node.req.ping(msg.params as string).then(res => {
        // If the ping failed, return an error.
        if (!res.ok) {
          MessageBus.reject(msg.id, res.err)
          return
        }
        // Respond with the result.
        MessageBus.respond(msg.id, true)
      })
    }
    // For reset requests,
    case CLIENT_ACTION.RESET: {
      // Initialize the client.
      const err = init_node()
      // If error,
      if (err) {
        // Send a rejection.
        MessageBus.reject(msg.id, err)
      } else {
        // Send a response.
        MessageBus.respond(msg.id, _global.info)
        // Dispatch a refresh event.
        dispatch_info()
      }
      // Break.
      break
    }
    // For unlock requests,
    case CLIENT_ACTION.UNLOCK: {
      // Try to unlock the client.
      const err = unlock_client(msg.params)
      // Handle the result,
      if (err) {
        // Send a rejection with the error.
        MessageBus.reject(msg.id, err)
      } else {
        // Send a response.
        MessageBus.respond(msg.id, _global.info)
        // Send a refresh event.
        dispatch_info()
      }
      // break.
      break
    }
  }
}

function init_node () {
  try {
    // Unpack the global state.
    const { share, store } = _global
    // If the store is missing data, return early.
    if (!share || !can_init()) return 'store is not fully initialized'
    // Extract the urls from the relay policies.
    const urls = store.relays.map(e => e.url)
    // Initalize the bifrost node.
    const node = new BifrostNode(store.group!, share, urls)

    node.on('ready', () => {
      console.log('[ node ] node is ready')
      update_client_info()
      dispatch_info()
    })

    node.connect()

    _global.node = node
    return null
  } catch (err) {
    // Log the error.
    console.error(err)
    // Return an error response.
    return 'failed to initialize the client'
  }
}

async function init_store () {
  // Fetch the store data.
  const store = await DBController.load(STORE_KEY) as ClientStore
  console.log(' [ client/service ] store', store)
  // TODO: validate this.
  _global.store = store
}

async function get_client () {
  // If client is not present.
  if (!_global.node) {
    // Initialize the client.
    const err = init_node()
    // If error, log to console.
    if (err) console.error(err)
  }
  // Return the client, or null.
  return _global.node
}

function clear_client () {
  _global.node  = null
  _global.share = null
}

function get_status () : ClientStatus {
  // Unpack global object.
  const { node, share } = _global
  // If client node exists,
  if (node) {
    // Set the status based on node readiness.
    return (node.is_ready) ? 'online' : 'connecting'
  // Else if a share is present,
  } else if (can_init() && !share) {
    // Return locked status.
    return 'locked'
  } else {
    // Return pending status.
    return 'offline'
  }
}

function dispatch_info () {
  // Send an update event.
  MessageBus.send({ topic: CLIENT_ACTION.EVENT, payload: _global.info, })
}

function subscribe_to_store () {
  DBController.subscribe(STORE_KEY, (changed) => {
    const data = { ..._global.store, ...changed }
    // Check if we should clear the node.
    const can_clear = should_clear(data)
    // Check if we should reset the node.
    const can_reset = should_reset(data)
    // If we should, clear the client data.
    if (can_clear) clear_client()
    // Update the global store.
    _global.store   = data
    // If we should, reset the node.
    if (!can_clear && can_init() && can_reset) init_node()
  })
}

function unlock_client (password : unknown) : string | null {
  // If password is not a string, return error.
  if (typeof password !== 'string') return 'password is not a string'
  // If share is already unlocked, return error.
  if (_global.share) return 'share already unlocked'
  // If secret share is not configured, return error.
  if (!_global.store?.share) return 'secret share not configured'
  // If client can't be initialized, return error.
  if (!can_init()) return 'client settings not fully configured'
  // Try to decrypt the secret share.
  const decrypted = decrypt_secret(_global.store.share, password)
  // If the decryption failed, return error.
  if (!decrypted) return 'failed to decrypt secret share'
  // Try to decode the decrypted share.
  const decoded = decode_share(decrypted)
  // If the decoding failed, return error.
  if (!decoded) return 'failed to decode share package'
  // Save the decoded package as the global secret share.
  _global.share = decoded
  // Try to initalize the client, and return the results.
  return init_node()
}

function update_client_info () {
  const { node } = _global
  // Fetch the current status.
  _global.info.status = get_status()
  // If the client node is initiated,
  if (node !== null) {
    // Define the current node info.
    _global.info.peers  = node.peers
    _global.info.pubkey = node.pubkey
  }
}

function can_init () : boolean {
  // If either share or store is not initialized, return false.
  if (!_global.store) return false
  console.log(_global)
  // Unpack store object.
  const { group, share, relays } = _global.store
  // Test if the store has the required data to initialize.
  return !!group && !!share && relays.length > 0
}

function should_clear (store : ClientStore) {
  const global_share = _global?.store?.share ?? null
  const store_share  = store.share
  return (global_share !== store_share)
}

function should_reset (store : ClientStore) {
  // If we can't initialize, then return false.
  if (!_global.store || !_global.share) return false
  // Define the global store.
  const global = _global.store
  // If the share data has changed, return false.
  if (store.share !== global.share) return false
  // If the group data has changed, return true.
  if (store.group !== global.group) return true
  // If the relay policy has changed, return true.
  if (!JsonUtil.is_equal(store.peers, global.peers)) return true
  // If the relay policy has changed, return true.
  if (!JsonUtil.is_equal(store.relays, global.relays)) return true
  // By default, return false.
  return false
}

function register_logging (node : BifrostNode) {
  node.on('*', (event, data) => {
    // Skip message events.
    if (event === 'message') return
    if (event.startsWith('/ping')) return

    let type: LogType = 'info' // Default log type
    let message = String(event)
    let payload: any = data

    // Determine log type and refine message based on event string
    if (message.toLowerCase() === 'ready') {
      type = 'ready'
      payload = undefined // No payload for ready events
    } else if (message.startsWith('/sign')) {
      type = 'sign' // General sign type, can be refined
      if (message.endsWith('/req')) {
        type = 'req'
      } else if (message.endsWith('/res')) {
        type = 'res'
      }
    } else if (message.startsWith('/error')) {
      type = 'error'
    } // Add more specific event type handling as needed

    // If payload is an empty object, set it to undefined so no dropdown is shown
    if (typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0) {
      payload = undefined
    }

    const log_entry: LogEntry = {
      timestamp: Date.now(),
      message: message,
      type: type,
      payload: payload
    }

    _global.logs = update_log(_global.logs, log_entry)
  })
}

function update_log (current : LogEntry[], log : LogEntry) {
  let new_logs = [ ...current, log ]
  if (new_logs.length > LOG_LIMIT) {
    const diff = new_logs.length - LOG_LIMIT
    new_logs = new_logs.slice(diff)
  }
  return new_logs
}
