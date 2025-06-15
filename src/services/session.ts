import { ConnectionToken, SessionClient, SessionToken } from '@cmdcode/nostr-connect'

import { BifrostSignDevice } from '@/class/signer.js'
import { ClientService }  from '@/services/client.js'
import { DBController }   from '@/core/db.js'
import { MessageBus }     from '@/core/mbus.js'
import * as CONST         from '@/const.js' 

import type {
  ClientStatus,
  ClientStore,
  RequestMessage
} from '@/types/index.js'
import { validate_node_state } from '@/lib/validate'

const CLIENT_ACTION  = CONST.SYMBOLS.CLIENT
const SESSION_ACTION = CONST.SYMBOLS.SESSION
const STORE_KEY      = CONST.STORE_KEY

const DEFAULT_STATE = {
  active  : [],
  pending : []
}

const PARAMS_REQUIRED = [
  SESSION_ACTION.CANCEL,
  SESSION_ACTION.CONNECT,
  SESSION_ACTION.REVOKE,
  SESSION_ACTION.UPDATE
]

let _client : SessionClient | null = null

export namespace SessionService {
  export const get_client = get_session_client
  export const handler    = handle_session_message
  export const register   = register_session_service
}

function register_session_service () {
  // Subscribe to node updates.
  subscribe_to_node()
}

function subscribe_to_node () {
  // Create a filter for client events.
  const filter = { topic: CLIENT_ACTION.EVENT }
  // Subscribe to client messages.
  MessageBus.subscribe(filter, async (msg) => {
    // If the message is not an event, return.
    if (msg.type !== 'event') return
    // Validate the message.
    if (!validate_node_state(msg.payload)) return
    // Get the status of the client.
    const status = msg.payload.status
    // If the client is not initialized and the status is online,
    if (!_client && status === 'online') {
      // Initialize the client.
      const err = await init_session_client()
      // If the initialization failed, log the error.
      if (err) console.error(err)
      // Update the sessions.
      update_sessions()
    // If the client is initialized and the status is not online,
    } else if (_client && status !== 'online') {
      // Clear the client.
      clear_session_client()
      // Update the sessions.
      update_sessions()
    }
  })
}

async function init_session_client () : Promise<string | null> {
  try {
    const node   = await ClientService.get()
    if (!node) return 'bifrost node not initialized'
    const signer = new BifrostSignDevice(node)
    const pubkey = await signer.get_pubkey()
    const store  = await DBController.load(STORE_KEY) as ClientStore
    const client = new SessionClient(pubkey, signer, { sessions: store.sessions })

    client.on('ready', () => {
      console.log('[ session ] session client ready')
    })

    client.on('error', (err) => {
      console.error('[ session ] session client error:', err)
    })

    if (store.sessions.length > 0) {
      client.connect()
    }

    _client = client
    return null
  } catch (err) {
    console.error(err)
    return 'failed to initialize client'
  }
}

function get_session_client () : SessionClient | null {
  return _client
}

function clear_session_client () {
  const client = _client
  if (client) client.close()
  _client = null
}

function get_session_state () {
  if (!_client) return DEFAULT_STATE
  const active  = _client.session.active
  const pending = _client.session.pending
  return { active, pending }
}

function update_sessions () {
  // Get the current state of sessions.
  const state = get_session_state()
  // Update the store.
  DBController.save(STORE_KEY, { sessions : state.active })
  // Send an event to refresh the frontend.
  MessageBus.send({ topic: SESSION_ACTION.EVENT, payload: state, })
}

function handle_session_message (msg : RequestMessage) {
  const client = _client
  // If the message is a fetch request,
  if (msg.topic === SESSION_ACTION.FETCH) {
    // Get the current state of sessions.
    const state = get_session_state()
    // Respond with the latest info.
    MessageBus.respond(msg.id, state)
    return
  }
  // If the message is a reset request,
  if (msg.topic === SESSION_ACTION.RESET) {
    // Initialize the client.
    init_session_client().then(err => {
      if (err) {
        // If the initialization failed, reject the request.
        MessageBus.reject(msg.id, err)
      } else {
        // If the initialization succeeded, respond with success.
        MessageBus.respond(msg.id, true)
      }
    })
    return
  }
  // If the client is not initialized, reject the request.
  if (!client) {
    MessageBus.reject(msg.id, 'client is not initialized')
    return
  }
  // If the message is missing parameters, reject the request.
  if (PARAMS_REQUIRED.includes(msg.topic) && !msg.params) {
    MessageBus.reject(msg.id, 'parameters missing from request')
    return
  }
  // Try to handle the request.
  try {
    switch (msg.topic) {
      case SESSION_ACTION.CANCEL: {
        client.session.cancel(msg.params as string)
        MessageBus.respond(msg.id, true)
        update_sessions()
        break
      }
      case SESSION_ACTION.CONNECT: {
        client.session.register(msg.params as ConnectionToken)
        MessageBus.respond(msg.id, true)
        update_sessions()
        break
      }
      case SESSION_ACTION.REVOKE: {
        client.session.revoke(msg.params as string)
        MessageBus.respond(msg.id, true)
        update_sessions()
        break
      }
      case SESSION_ACTION.UPDATE: {
        client.session.update(msg.params as SessionToken)
        MessageBus.respond(msg.id, true)
        update_sessions()
        break
      }
    }
  } catch (err) {
    console.error(err)
    MessageBus.reject(msg.id, 'error handling session message')
  }
}
