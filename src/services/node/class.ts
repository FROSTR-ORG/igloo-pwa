import { BifrostNode }      from '@frostr/bifrost'
import { EventEmitter }     from '@vbyte/micro-lib'
import { GlobalController } from '@/core/global.js'
import { decrypt_secret }   from '@/lib/crypto.js'
import { decode_share }     from '@/lib/encoder.js'
import * as CONST           from '@/const.js'
import { logger }           from '@/logger.js'

import {
  handle_node_message,
  handle_settings_updates
} from './handler.js'

import {
  get_node_status,
  has_node_config
} from './lib.js'

import {
  attach_console,
  attach_debugger,
  attach_listeners,
  ping_peers,
  start_bifrost_node
} from './startup.js'

import type {
  MessageEnvelope,
  GlobalInitScope,
  BifrostState,
  MessageFilter
} from '@/types/index.js'

const LOG    = logger('node')
const DOMAIN = CONST.SYMBOLS.DOMAIN.NODE
const TOPIC  = CONST.SYMBOLS.TOPIC.NODE

export class BifrostController extends EventEmitter <{
  unlock : [ state : BifrostState ]
  ready  : any[]
  reset  : [ state : BifrostState ]
  closed : any[]
  error  : [ error : unknown ]
}> {
  private readonly _global : GlobalController

  private _client : BifrostNode | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
    LOG.debug('controller installed')
  }

  get client () : BifrostNode | null {
    return this._client
  }

  get global () {
    return this._global
  }

  get has_config () : boolean {
    return has_node_config(this)
  }

  get has_share () : boolean {
    return !!this.global.scope.private.share
  }

  get is_active () : boolean {
    return this.client?.is_ready ?? false
  }

  get is_ready () : boolean {
    const share = this.global.scope.private.share
    return this.has_config && !!share
  }

  get state () : BifrostState {
    return {
      peers  : this.client?.peers ?? [],
      pubkey : this.client?.pubkey ?? null,
      status : this.status
    }
  }

  get status () : string {
    return get_node_status(this)
  }

  set client (client : BifrostNode | null) {
    this._client = client
  }

  _dispatch (payload : BifrostState) {
    // Send a node status event.
    this.global.mbus.publish({
      domain  : DOMAIN,
      topic   : TOPIC.EVENT,
      payload : payload
    })
  }

  _handler (msg : MessageEnvelope) {
    if (msg.type !== 'request') return
    handle_node_message(this, msg)
  }

  _start () {
    // If the node is not ready, return.
    if (!this.is_ready) return
    // If the node is already initialized, return.
    try {
      // Initialize the node.
      const node = start_bifrost_node(this)
      // Configure the ready event.
      node.once('ready', () => {
        // Attach the listeners.
        attach_listeners(this)
        // Attach the console.
        attach_console(this)
        // Attach the debugger.
        attach_debugger(this)
        // Ping the peers.
        ping_peers(this)
        // Dispatch the new node state.
        this._dispatch(this.state)
        // Emit the ready event.
        this.emit('ready')
        // Log the ready event.
        LOG.info('node ready')
      })
      // Connect the node.
      node.connect()
      // Update the global state.
      this.client = node
      // Dispatch the new node state.
      this._dispatch(this.state)
    } catch (err) {
      // Log the error.
      LOG.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
    }
  }

  init () {
    // Define a filter for the message bus.
    const filter : MessageFilter = { domain : DOMAIN }
    // Subscribe to node messages.
    this.global.mbus.subscribe((msg) => handle_node_message(this, msg), filter)
    // Subscribe to settings updates.
    this.global.settings.on('update', (current, updated) => {
      handle_settings_updates(this, current, updated)
    })
    // Log the initialization.
    LOG.info('service activated')
  }

  reset () {
    // Reset the node.
    this.client = null
    // Dispatch the node state.
    this._dispatch(this.state)
    // Emit the reset event.
    this.emit('reset', this.state)
    // Log the reset event.
    LOG.info('node reset')
    // Run the node boot process.
    this._start()
  }

  unlock (password : string) {
    // If password is not a string, return error.
    if (typeof password !== 'string') return 'password is not a string'
    // Get the share from the settings.
    const share = this.global.settings.data.share
    // If the share is not present, return error.
    if (!share) return 'share not present'
    // Try to decrypt the secret share.
    const decrypted = decrypt_secret(share, password)
    // If the decryption failed, return error.
    if (!decrypted) return 'failed to decrypt private data'
    // Try to parse the decrypted data.
    const parsed = decode_share(decrypted)
    // If the parsing failed, return error.
    if (!parsed) return 'failed to decode share package'
    // Update the private store.
    this.global.private.share = parsed
    // Emit the unlock event.
    this.emit('unlock', this.state)
    // Log the unlock event.
    LOG.info('node unlocked')
    // Run the node boot process.
    this._start()
  }
}
