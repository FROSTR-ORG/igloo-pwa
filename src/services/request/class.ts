import { Assert, EventEmitter } from '@vbyte/micro-lib'
import { GlobalController }     from '@/core/global.js'
import * as CONST               from '@/const.js'
import { logger }               from '@/logger.js'

import { handle_request_message }         from './handler.js'
import { attach_console, register_hooks } from './startup.js'

import type {
  GlobalInitScope,
  RequestMessage,
  RequestState
} from '@/types/index.js'

import type {
  PermissionPolicy,
  PermissionRequest,
  SignerClient,
  SignerSession
} from '@cmdcode/nostr-connect'

const LOG = logger('request')

const REQUEST_DOMAIN = CONST.SYMBOLS.DOMAIN.REQUEST
const REQUEST_TOPIC  = CONST.SYMBOLS.TOPIC.REQUEST

export class RequestController extends EventEmitter <{
  approve : [ req : PermissionRequest ]
  deny    : [ req : PermissionRequest, reason : string ]
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

  get state () : RequestState | null {
    if (!this.is_ready) return null
    return { queue : this.client.request.queue }
  }

  _dispatch () {
    // Dispatch the session state.
    this.global.mbus.publish({
      domain  : REQUEST_DOMAIN,
      topic   : REQUEST_TOPIC.EVENT,
      payload : this.state
    })
  }

  _handler (msg : RequestMessage) {
    // If the message is not a session message, return.
    if (msg.domain !== REQUEST_DOMAIN) return
    // Handle the session message.
    handle_request_message(this, msg)
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
    // Dispatch the request state.
    this._dispatch()
  }

  _update (sessions? : SignerSession[]) {
    // If the session is not found, return.
    if (!sessions && this.client.session.active.length === 0) return
    // Update the session in the cache.
    this.global.service.cache.update({
      sessions: sessions ?? this.client.session.active
    })
  }

  init () {
    // Log the initialization.
    LOG.info('service initializing')
    // Subscribe to node ready event.
    this.global.service.signer.on('ready', () => { this._start() })
    // Subscribe to request messages.
    this.global.mbus.subscribe(this._handler.bind(this))
  }

  async approve (
    req      : PermissionRequest,
    changes ?: PermissionPolicy
  ) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to approve a request before ready')
    // Log the connect event.
    LOG.info('approving request:', req)
    // Approve the request.
    this.client.request.approve(req, changes)
    // Dispatch the request state.
    this._dispatch()
    // Emit the approve event.
    this.emit('approve', req)
  }

  async deny (
    req      : PermissionRequest,
    reason   : string,
    changes? : PermissionPolicy
  ) : Promise<void> {
    // If the session is not found, throw an error.
    Assert.ok(this.is_ready, 'tried to deny a request before ready')
    // Log the deny event.
    LOG.info('denying request:', req)
    // Deny the request.
    this.client.request.deny(req, reason, changes)
    // Dispatch the request state.
    this._dispatch()
    // Emit the deny event.
    this.emit('deny', req, reason)
  }
}