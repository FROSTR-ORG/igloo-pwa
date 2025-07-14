import { Assert, EventEmitter } from '@vbyte/micro-lib'
import { GlobalController }     from '@/core/global.js'
import * as CONST               from '@/const.js'
import { logger }               from '@/logger.js'

import { handle_session_message }         from './handler.js'
import { attach_console, register_hooks } from './startup.js'

import type {
  GlobalInitScope,
  RequestMessage,
  SessionState
} from '@/types/index.js'

import type {
  InviteToken,
  SignerClient,
  SignerSession
} from '@cmdcode/nostr-connect'

const LOG    = logger('session')
const DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION
const TOPIC  = CONST.SYMBOLS.TOPIC.SESSION

export class SessionController extends EventEmitter <{
  connect : [ session    : InviteToken ]
  active  : [ session    : SignerSession ]
  revoked : [ pubkey     : string ]
  update  : [ session    : SignerSession ]
  clear   : []
}> {
  private readonly _global : GlobalController

  private _client : SignerClient | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
  }

  get client () : SignerClient {
    Assert.exists(this._client, 'signer client accessed before start')
    return this._client
  }

  get global () {
    return this._global
  }

  get is_ready () : boolean {
    return this.global.service.signer.is_ready
  }

  get state () : SessionState | null {
    if (!this.is_ready) return null
    return {
      active  : this.client.session.active,
      pending : this.client.session.pending
    }
  }

  _dispatch () {
    // Dispatch the session state.
    this.global.mbus.publish({
      domain  : DOMAIN,
      topic   : TOPIC.EVENT,
      payload : this.state
    })
  }

  _handler (msg : RequestMessage) {
    // If the message is not a session message, return.
    if (msg.domain !== DOMAIN) return
    // Handle the session message.
    handle_session_message(this, msg)
  }

  _start () {
    // Log the start event.
    LOG.info('service starting')
    // Start the rpc services.
    this._client = this.global.service.signer.client
    // Attach the hooks.
    register_hooks(this)
    // Attach the console.
    attach_console(this)
    // Dispatch the session state.
    this._dispatch()
  }

  _update () {
    // If the session is not found, throw an error.
    Assert.ok(this.state, 'tried to update sessions before ready')
    // Log the update event.
    LOG.info('updating session cache')
    // Update the session in the cache.
    this.global.service.cache.update({ sessions: this.state.active })
  }

  init () {
    // Log the initialization.
    LOG.info('service initializing')
    // Subscribe to node ready event.
    this.global.service.signer.on('ready', () => { this._start() })
    // Subscribe to session messages.
    this.global.mbus.subscribe(this._handler.bind(this))
  }

  async connect (session : InviteToken) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to connect to a session before ready')
    // Log the connect event.
    LOG.info('connecting to session:', session)
    // Connect to the session.
    this.client.session.connect(session)
    // Emit the connect event.
    this.emit('connect', session)
  }

  async clear () : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to clear sessions before ready')
    // Log the clear event.
    LOG.info('clearing sessions')
    // Clear the sessions.
    this.client.session.reset()
    // Emit the clear event.
    this.emit('clear')
  }

  async revoke (pubkey : string) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to revoke a session before ready')
    // Log the revoke event.
    LOG.info('revoking session:', pubkey)
    try {
      // Revoke the session.
      this.client.session.revoke(pubkey)
      console.log('session state:', this.state)
      // Emit the revoke event.
      this.emit('revoked', pubkey)
    } catch (err) {
      // Log the error.
      LOG.error('error during revoke:', err)
    }
  }

  async update (session : SignerSession) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to update a session before ready')
    // Log the update event.
    LOG.info('updating session:', session)
    // Update the session.
    this.client.session.update(session)
    // Emit the update event.
    this.emit('update', session)
  }
}