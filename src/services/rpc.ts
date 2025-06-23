import { EventEmitter }      from '@/class/emitter.js'
import { BifrostSignDevice } from '@/class/signer.js'
import { GlobalController }  from '@/core/global.js'

import {
  NostrClient,
  SessionManager
} from '@cmdcode/nostr-connect'

import type { GlobalInitScope } from '@/types/index.js'

export class RpcController extends EventEmitter {
  private readonly _global : GlobalController

  private _client  : NostrClient       | null = null
  private _session : SessionManager    | null = null
  private _signer  : BifrostSignDevice | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
  }

  get global () {
    return this._global
  }

  get can_init () : boolean {
    // Define the enclave from the global state.
    const enclave = this.global.scope.enclave
    // If the enclave is not ready, return false.
    if (!enclave || !enclave.is_ready) return false
    // Define the share from the enclave store.
    const share = enclave.store.share
    // If the share is not present, return false.
    if (!share) return false
    // If all checks pass, return true.
    return true
  }

  get is_ready () : boolean {
    return (
      this._client  !== null &&
      this._session !== null &&
      this.client.is_ready
    )
  }

  get client () : NostrClient {
    if (!this._client) {
      throw new Error('client not initialized')
    }
    return this._client
  }

  get session () : SessionManager {
    if (!this._session) {
      throw new Error('session not initialized')
    }
    return this._session
  }

  get signer () : BifrostSignDevice {
    if (!this._signer) {
      throw new Error('signer not initialized')
    }
    return this._signer
  }

  _dispatch (event : string) : void {
    // TODO: Implement this.
  }

  async init () : Promise<string | null> {
    // Fetch the bifrost node from the global state.
    const node = this.global.scope.node.client
    // If the node is not initialized, return an error.
    if (!node) return 'bifrost node not initialized'
    // Fetch the sessions from the cache.
    const sessions = this.global.scope.cache.data.sessions
    // Create a new signer.
    const signer  = new BifrostSignDevice(node)
    // Create a new client.
    const client  = new NostrClient(signer)
    // Create a new session manager.
    const session = new SessionManager(client, { sessions })
    // Update the global state.
    this._client  = client
    this._session = session
    this._signer  = signer
    // Return null for success.
    return null
  }

  async subscribe () : Promise<void> {
    // TODO: Implement this.
  }

  async reset () : Promise<void> {
    this._client  = null
    this._session = null
    this._signer  = null
  }
}

// function get_private_store (global : GlobalState) : PrivateEnclave | null {
//   const enclave = global.enclave
//   if (!enclave || !enclave.is_ready) return null
//   return global.enclave?.store
// }

// function register_session_service () {
//   // Subscribe to node updates.
//   subscribe_to_node()
// }

// function subscribe_to_node () {
//   // Create a filter for client events.
//   const filter = { topic: CLIENT_ACTION.EVENT }
//   // Subscribe to client messages.
//   MessageBus.subscribe(filter, async (msg) => {
//     // If the message is not an event, return.
//     if (msg.type !== 'event') return
//     // Validate the message.
//     if (!validate_node_state(msg.payload)) return
//     // Get the status of the client.
//     const status = msg.payload.status
//     // If the client is not initialized and the status is online,
//     if (!self.rpc && status === 'online') {
//       // Initialize the client.
//       const err = await init_session_client()
//       // If the initialization failed, log the error.
//       if (err) console.error('[ session ] failed to auto-init session client:', err)
//       // Update the sessions.
//       update_sessions()
//     // If the client is initialized and the status is not online,
//     } else if (self.rpc && status !== 'online') {
//       // Clear the client.
//       clear_session_client()
//       // Update the sessions.
//       update_sessions()
//     }
//   })
// }

// async function init_session_client () : Promise<string | null> {
//   try {
//     const node   = BifrostNodeService.get()
//     if (!node) return 'bifrost node not initialized'
//     const signer = new BifrostSignDevice(node)
//     const pubkey = signer.get_pubkey()
//     const store  = await DBController.load(STORE_KEY) as AppStore
//     const client = new NostrClient(pubkey, signer, { sessions: store.sessions, debug: true })

//     init_logger(client)

//     if (client.relays.length > 0) {
//       client.connect()
//     }

//     self.rpc = client
//     return null
//   } catch (err) {
//     console.error(err)
//     return 'error during initialization'
//   }
// }

// function get_session_client () : SessionClient | null {
//   if (!self.rpc) {
//     const err = init_session_client()
//     if (err) {
//       console.error('[ session ] failed to auto-init session client:', err)
//       return null
//     }
//   }
//   return self.rpc
// }

// function clear_session_client () {
//   if (self.rpc) {
//     self.rpc.close()
//     self.rpc = null
//   }
// }

// function get_session_state () {
//   if (!self.rpc) return DEFAULT_STATE
//   const active  = self.rpc.session.active
//   const pending = self.rpc.session.pending
//   return { active, pending }
// }

// function update_sessions () {
//   // Get the current state of sessions.
//   const state = get_session_state()
//   // Update the store.
//   DBController.save(STORE_KEY, { sessions : state.active })
//   // Send an event to refresh the frontend.
//   MessageBus.send({ topic: SESSION_ACTION.EVENT, payload: state })
// }

// async function handle_session_message (msg : RequestMessage) {
//   // If the message is a fetch request,
//   if (msg.topic === SESSION_ACTION.FETCH) {
//     // Get the current state of sessions.
//     const state = get_session_state()
//     // Respond with the latest info.
//     MessageBus.respond(msg.id, state)
//     return
//   }
//   // If the message is a reset request,
//   if (msg.topic === SESSION_ACTION.RESET) {
//     // Initialize the client.
//     init_session_client().then(err => {
//       if (err) {
//         // If the initialization failed, reject the request.
//         MessageBus.reject(msg.id, err)
//       } else {
//         // If the initialization succeeded, respond with success.
//         MessageBus.respond(msg.id, true)
//       }
//     })
//     return
//   }
//   // If the client is not initialized, reject the request.
//   if (!self.rpc) {
//     MessageBus.reject(msg.id, 'client is not initialized')
//     return
//   }
//   // If the message is missing parameters, reject the request.
//   if (PARAMS_REQUIRED.includes(msg.topic) && !msg.params) {
//     MessageBus.reject(msg.id, 'parameters missing from request')
//     return
//   }
//   // Try to handle the request.
//   try {
//     switch (msg.topic) {
//       case SESSION_ACTION.CANCEL: {
//         self.rpc.session.cancel(msg.params as string)
//         MessageBus.respond(msg.id, true)
//         update_sessions()
//         break
//       }
//       case SESSION_ACTION.CONNECT: {
//         if (!self.rpc) {
//           const err = await init_session_client()
//           if (err) {
//             MessageBus.reject(msg.id, err)
//             return
//           }
//         }
//         await self.rpc.session.register(msg.params as ConnectionToken)
//         MessageBus.respond(msg.id, true)
//         update_sessions()
//         console.log('[ session ] session client:', self.rpc)
//         break
//       }
//       case SESSION_ACTION.REVOKE: {
//         self.rpc.session.revoke(msg.params as string)
//         MessageBus.respond(msg.id, true)
//         update_sessions()
//         break
//       }
//       case SESSION_ACTION.UPDATE: {
//         await self.rpc.session.update(msg.params as SessionToken)
//         MessageBus.respond(msg.id, true)
//         update_sessions()
//         break
//       }
//     }
//   } catch (err) {
//     console.error(err)
//     MessageBus.reject(msg.id, 'error handling session message')
//   }
// }

