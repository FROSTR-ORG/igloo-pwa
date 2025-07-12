import { Assert }                 from '@vbyte/micro-lib/assert'
import { EventEmitter }           from '@vbyte/micro-lib'
import { GlobalController }       from '@/core/global.js'
import { logger }                 from '@/logger.js'
import { get_session_status }     from './lib.js'
import { handle_session_message } from './handler.js'
import * as CONST                 from '@/const.js'

import {
  InviteToken,
  RequestMessage,
  SignerClient,
  SignerSession
} from '@cmdcode/nostr-connect'

import {
  attach_rpc_console,
  attach_rpc_debugger,
  attach_rpc_listeners,
  start_rpc_service
} from './startup.js'

import type {
  GlobalInitScope,
  MessageEnvelope,
  SessionState
} from '@/types/index.js'

const LOG = logger('signer')

const SESSION_DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION
const SESSION_TOPIC  = CONST.SYMBOLS.TOPIC.SESSION

export class SignerController extends EventEmitter <{
  error   : any[]
  ready   : any[]
  reset   : any[]
  connect : [ connection : InviteToken ]
  revoke  : [ session_id : string ]
  update  : [ session    : SignerSession ]
}> {
  private readonly _global : GlobalController

  private _client  : SignerClient | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
    LOG.debug('controller installed')
  }

  get global () {
    return this._global
  }

  get is_ready () : boolean {
    return (this.global.service.node.is_ready && this._client !== null)
  }

  get client () : SignerClient {
    Assert.exists(this._client, 'signer client called before start')
    return this._client!
  }

  get state () : SessionState {
    return {
      active  : this.client.session.active,
      pending : this.client.session.pending
    }
  }

  get status () : string {
    return get_session_status(this)
  }

  _dispatch () : void {
    this.global.mbus.publish({
      topic   : SESSION_TOPIC.EVENT,
      payload : this.status
    })
  }

  _handler (msg : RequestMessage) {
    handle_session_message(this, msg)
  }

  _start () {
    try {
      // If the bifrost node is not ready, return.
      if (!this.is_ready) return
      // Start the rpc services.
      const { client, session, signer } = start_rpc_service(this)
      // Attach the event listeners.
      client.on('ready', () => {
        // Attach the rpc listeners.
        attach_rpc_listeners(this)
        // Attach the rpc console.
        attach_rpc_console(this)  
        // Attach the rpc debugger.
        attach_rpc_debugger(this)
        // Dispatch the session state.
        this._dispatch()
        // Emit the ready event.
        this.emit('ready')
        // Log the ready event.
        LOG.info('signer ready')
      })
      // Update the global state.
      this._client  = client
      // Dispatch the session state.
      this._dispatch()
      // Subscribe to the active session relays.
      const relays = session.active.map(s => s.relays).flat()
      if (relays.length > 0) client.connect(relays)
    } catch (err) {
      // Log the error.
      LOG.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
    }
  }

  _update_cache (sessions? : SignerSession[]) {
    // If the session is not found, return.
    if (!sessions && this.client.session.active.length === 0) return
    // Update the session in the cache.
    this.global.cache.update({
      sessions: sessions ?? this.client.session.active
    })
  }

  init () {
    // Subscribe to node ready event.
    this.global.service.node.on('ready', () => { this._start() })
    // Subscribe to session messages.
    this.global.mbus.subscribe(this._handler.bind(this))
    // Log the initialization.
    LOG.info('service activated')
  }

  async connect (session : InviteToken) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to connect to a session before ready')
    // Connect to the session.
    this.client.session.connect(session)
    // Dispatch the session state.
    this._dispatch()
    // Emit the connect event.
    this.emit('connect', session)
    // Log the connect event.
    LOG.info('connecting to session:', session)
  }

  fetch () : SessionState | null {
    // If the session is not found, return an error.
    if (!this.is_ready) return null
    // Return the session state.
    return this.state
  }

  reset () {
    // Log the reset event.
    LOG.info('resetting signer')
    // Reset the client, session, and signer.
    this._client = null
    // Update the session in the cache.
    this._update_cache([])
    // Dispatch the session state.
    this._dispatch()
    // Emit the reset event.
    this.emit('reset')
    // Run the session boot process.
    this._start()
  }

  async revoke (session_id : string) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to revoke a session before ready')
    // Log the revoke event.
    LOG.info('revoking session:', session_id)
    // Revoke the session.
    this.client.session.revoke(session_id)
    // Update the session in the cache.
    this._update_cache([])
    // Dispatch the session state.
    this._dispatch()
    // Emit the revoke event.
    this.emit('revoke', session_id)
  }

  async update (session : SignerSession) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to update a session before ready')
    // Log the update event.
    LOG.info('updating session:', session)
    // Update the session.
    this.client.session.update(session)
    // Update the session in the cache.
    this._update_cache()
    // Dispatch the session state.
    this._dispatch()
    // Emit the update event.
    this.emit('update', session)
  }
}
