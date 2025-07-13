import { Assert }                 from '@vbyte/micro-lib/assert'
import { EventEmitter }           from '@vbyte/micro-lib'
import { GlobalController }       from '@/core/global.js'
import { logger }                 from '@/logger.js'
import * as CONST                 from '@/const.js'
import { handle_signer_message } from './handler.js'

import type { SignerClient } from '@cmdcode/nostr-connect'

import {
  attach_console,
  create_client,
} from './startup.js'

import type {
  GlobalInitScope,
  RequestMessage,
  SignerState
} from '@/types/index.js'

const LOG = logger('signer')

const SIGNER_DOMAIN = CONST.SYMBOLS.DOMAIN.SIGNER
const SIGNER_TOPIC  = CONST.SYMBOLS.TOPIC.SIGNER

export class SignerController extends EventEmitter <{
  error : [ error : any ]
  ready : []
  reset : []
}> {
  private readonly _global : GlobalController

  private _client  : SignerClient | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
    LOG.debug('controller installed')
  }

  get can_start () : boolean {
    return this.global.service.node.is_ready
  }

  get global () {
    return this._global
  }

  get is_ready () : boolean {
    return (this.can_start && this._client !== null)
  }

  get client () : SignerClient {
    Assert.exists(this._client, 'signer client called before start')
    return this._client
  }

  get state () : SignerState {
    return { status : this.status }
  }

  get status () : string {
    return get_status(this)
  }

  _dispatch () : void {
    this.global.mbus.publish({
      domain  : SIGNER_DOMAIN,
      topic   : SIGNER_TOPIC.EVENT,
      payload : this.state
    })
  }

  _handler (msg : RequestMessage) {
    handle_signer_message(this, msg)
  }

  _start () {
    try {
      // If the bifrost node is not ready, return.
      if (!this.can_start) return
      // Start the rpc services.
      const client = create_client(this)
      // Attach the event listeners.
      client.on('ready', () => {
        // Attach the console.
        attach_console(this)  
        // Dispatch the session state.
        this._dispatch()
        // Emit the ready event.
        this.emit('ready')
        // Log the ready event.
        LOG.info('signer ready')
      })
      // Update the global state.
      this._client  = client
      // Dispatch the signer state.
      this._dispatch()
    } catch (err) {
      // Log the error.
      LOG.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
    }
  }

  init () {
    // Log the initialization.
    LOG.info('service initializing')
    // Subscribe to node ready event.
    this.global.service.node.on('ready', () => { this._start() })
    // Subscribe to session messages.
    this.global.mbus.subscribe(this._handler.bind(this))
  }

  fetch () : SignerState | null {
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
    // Dispatch the session state.
    this._dispatch()
    // Emit the reset event.
    this.emit('reset')
    // Run the session boot process.
    this._start()
  }
}

export function get_status (self : SignerController) : string {
  if (self.is_ready) return 'online'
  if (self.client)   return 'connecting'
  return 'loading'
}
