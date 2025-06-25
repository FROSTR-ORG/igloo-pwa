import { Assert }                 from '@vbyte/micro-lib/assert'
import { EventEmitter }           from '@/class/emitter.js'
import { BifrostSignDevice }      from '@/class/signer.js'
import { CoreController }         from '@/core/ctrl.js'
import { create_logger }          from '@vbyte/micro-lib/logger'
import { get_session_status }     from './lib.js'
import { handle_session_message } from './handler.js'
import * as CONST                 from '@/const.js'

import {
  ConnectionToken,
  NostrClient,
  SessionManager,
  SessionToken
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
    this.log.debug('controller installed')
  }

  get global () {
    return this._global
  }

  get is_active () : boolean {
    return (
      this.client  !== null &&
      this.session !== null &&
      this.signer  !== null
    )
  }

  get is_ready () : boolean {
    const node = this.global.service.node.client
    return node !== null && node.is_ready
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
    console.log('starting rpc service')
    console.log('is ready:', this.is_ready)
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
        this.log.info('rpc service ready')
      })
      // Update the global state.
      this._client  = client
      this._session = session
      this._signer  = signer
      // Dispatch the session state.
      this._dispatch()
      // Subscribe to the active session relays.
      const relays = session.active.map(s => s.relays).flat()
      if (relays.length > 0) client.connect(relays)
    } catch (err) {
      // Log the error.
      this.log.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
    }
  }

  _update_cache (sessions? : SessionToken[]) {
    // If the session is not found, return.
    if (!sessions && !this.session) return
    // Update the session in the cache.
    this.global.store.cache.update({
      sessions: sessions ?? this.session?.active ?? []
    })
  }

  init () {
    // Subscribe to node ready event.
    this.global.service.node.on('ready', () => {
      this._start()
    })
    // Subscribe to session messages.
    this.global.mbus.subscribe(msg => {
      this._handler(msg)
    }, { domain: SESSION_DOMAIN })
    // Log the initialization.
    this.log.info('service activated')
  }

  async connect (session : ConnectionToken) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.exists(this.session, 'session controller not initialized')
    // Connect to the session.
    const res = await this.session.connect(session)
    // If the session ack is not found, return an error.
    Assert.ok(res.ok, 'failed to transmit over the relay')
    // Dispatch the session state.
    this._dispatch()
    // Emit the connect event.
    this.emit('connect', session)
    // Log the connect event.
    this.log.info('connecting to session:', session)
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
    // Update the session in the cache.
    this._update_cache([])
    // Dispatch the session state.
    this._dispatch()
    // Emit the reset event.
    this.emit('reset')
    // Log the reset event.
    this.log.info('rpc service reset')
    // Run the session boot process.
    this._start()
  }

  async revoke (session_id : string) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.exists(this.session, 'session controller not initialized')
    // Revoke the session.
    this.session.revoke(session_id)
    // Update the session in the cache.
    this._update_cache([])
    // Dispatch the session state.
    this._dispatch()
    // Emit the revoke event.
    this.emit('revoke', session_id)
    // Log the revoke event.
    this.log.info('revoked session:', session_id)
  }

  async update (session : SessionToken) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.exists(this.session, 'session controller not initialized')
    // Update the session.
    this.session.update(session)
    // Update the session in the cache.
    this._update_cache()
    // Dispatch the session state.
    this._dispatch()
    // Emit the update event.
    this.emit('update', session)
    // Log the update event.
    this.log.info('updated session:', session)
  }
}
