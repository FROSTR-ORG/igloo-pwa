import { EventEmitter }      from '@/class/emitter.js'
import { BifrostSignDevice } from '@/class/signer.js'
import { CoreController }    from '@/core/ctrl.js'
import { create_logger }     from '@vbyte/micro-lib/logger'
import * as CONST            from '@/const.js'

import {
  ConnectionToken,
  NostrClient,
  SessionManager,
  SessionToken
} from '@cmdcode/nostr-connect'

import type {
  GlobalInitScope,
  MessageEnvelope,
  SessionState
} from '@/types/index.js'

const SESSION_DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION
const SESSION_TOPIC  = CONST.SYMBOLS.TOPIC.SESSION

export class RpcController extends EventEmitter <{
  error   : any[]
  ready   : any[]
  reset   : any[]
  connect : [ connection : ConnectionToken ]
  revoke  : [ session_id : string ]
  update  : [ session    : SessionToken ]
}> {
  private readonly _global : CoreController

  private _client  : NostrClient       | null = null
  private _session : SessionManager    | null = null
  private _signer  : BifrostSignDevice | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = CoreController.fetch(scope)
  }

  get global () {
    return this._global
  }

  get is_ready () : boolean {
    return (
      this.client  !== null &&
      this.session !== null &&
      this.signer  !== null
    )
  }

  get log () {
    return create_logger('rpc')
  }

  get client () : NostrClient | null {
    return this._client
  }

  get session () : SessionManager | null {
    return this._session
  }

  get signer () : BifrostSignDevice | null {
    return this._signer
  }

  get state () : SessionState {
    return {
      active  : this.session?.active  ?? [],
      pending : this.session?.pending ?? [],
      status  : this.status
    }
  }

  get status () : string {
    return get_session_status(this)
  }

  _dispatch () : void {
    this.global.mbus.send({
      topic   : SESSION_TOPIC.EVENT,
      payload : this.state
    })
  }

  _handler (msg : MessageEnvelope) {
    handle_session_message(this, msg)
  }

  _start () {
    try {
      this.log.info('initializing rpc service...')
      // Fetch the bifrost node from the global state.
      const node = this.global.scope.node.client
      // If the node is not initialized, return an error.
      if (!node) throw new Error('bifrost node not initialized')
      // Fetch the sessions from the cache.
      const sessions = this.global.scope.cache.data.sessions
      // Create a new signer.
      const signer  = new BifrostSignDevice(node)
      // Create a new client.
      const client  = new NostrClient(signer)
      // Create a new session manager.
      const session = new SessionManager(client, { sessions })
      // Subscribe to session events.
      session.on('activated', (session) => {
        // Dispatch the session state.
        this._dispatch()
        // Log the session activated event.
        this.log.info('session activated:', session)
      })
      // Subscribe to client events.
      client.on('subscribed', () => {
        console.log('subscribed:', client.relays)
      })
      client.on('response', (response) => {
        console.log('response:', response)
      })
      client.on('request', (request) => {
        console.log('request:', request)
      })
      client.on('error', (error) => {
        console.log('error:', error)
      })
      // Subscribe to client events.
      client.on('published', (event) => {
        console.log('published:', event)
      })
      // Update the global state.
      this._client  = client
      this._session = session
      this._signer  = signer
      // Dispatch the session state.
      this._dispatch()
      // Emit the ready event.
      this.emit('ready')
      // Log the ready event.
      this.log.info('rpc service ready')
    } catch (err) {
      // Log the error.
      this.log.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
    }
  }

  init () {
    // Subscribe to node ready event.
    this.global.scope.node.on('ready', this._start.bind(this))
    // Subscribe to session messages.
    this.global.mbus.subscribe(this._handler.bind(this), { domain: SESSION_DOMAIN })
    // Log the initialization.
    this.log.info('initialized')
  }

  async connect (session : ConnectionToken) : Promise<string | null> {
    // If the session is not found, return an error.
    if (!this.session) return 'session controller not initialized'
    // Connect to the session.
    const res = await this.session.connect(session)
    // If the session ack is not found, return an error.
    if (!res.ok) return 'failed to transmit over the relay'
    // Dispatch the session state.
    this._dispatch()
    // Emit the connect event.
    this.emit('connect', session)
    // Log the connect event.
    this.log.info('connecting to session:', session)
    // Return null for success.
    console.log('client:', this.client?.is_ready)
    return null
  }

  fetch () : SessionState | null {
    // If the session is not found, return an error.
    if (!this.is_ready) return null
    // Return the session state.
    return this.state
  }

  reset () {
    // Reset the client, session, and signer.
    this._client  = null
    this._session = null
    this._signer  = null
    // Dispatch the session state.
    this._dispatch()
    // Emit the reset event.
    this.emit('reset')
    // Log the reset event.
    this.log.info('rpc service reset')
    // Run the session boot process.
    this._start()
    // Return null for success.
    return null
  }

  async revoke (session_id : string) : Promise<string | null> {
    // If the session is not found, return an error.
    if (!this.session) return 'session controller not initialized'
    // Revoke the session.
    this.session.revoke(session_id)
    // Dispatch the session state.
    this._dispatch()
    // Emit the revoke event.
    this.emit('revoke', session_id)
    // Log the revoke event.
    this.log.info('revoked session:', session_id)
    // Return null for success.
    return null
  }

  async update (session : SessionToken) : Promise<string | null> {
    // If the session is not found, return an error.
    if (!this.session) return 'session controller not initialized'
    // Update the session.
    this.session.update(session)
    // Dispatch the session state.
    this._dispatch()
    // Emit the update event.
    this.emit('update', session)
    // Log the update event.
    this.log.info('updated session:', session)
    // Return null for success.
    return null
  }
}

function get_session_status (self : RpcController) : string {
  if (self.is_ready) return 'online'
  if (self.client)   return 'connecting'
  return 'loading'
}

export async function handle_session_message (
  self : RpcController,
  msg  : MessageEnvelope
) {
  if (msg.type !== 'request') return
  switch (msg.topic) {
    case SESSION_TOPIC.CONNECT: {
      self.connect(msg.params as ConnectionToken).then(err => {
        if (!err) self.global.mbus.respond(msg.id, true)
        else self.global.mbus.reject(msg.id, err)
      })
      break
    }
    case SESSION_TOPIC.FETCH: {
      const state = self.fetch()
      if (state) self.global.mbus.respond(msg.id, state)
      else self.global.mbus.reject(msg.id, 'rpc client not initialized')
      break
    }
    case SESSION_TOPIC.RESET: {
      self.reset()
      self.global.mbus.respond(msg.id, true)
      break
    }
    case SESSION_TOPIC.REVOKE: {
      self.revoke(msg.params as string).then(err => {
        if (!err) self.global.mbus.respond(msg.id, true)
        else self.global.mbus.reject(msg.id, err)
      })
      break
    }
    case SESSION_TOPIC.UPDATE: {
      self.update(msg.params as SessionToken).then(err => {
        if (!err) self.global.mbus.respond(msg.id, true)
        else self.global.mbus.reject(msg.id, err)
      })
      break
    }
  }
}
