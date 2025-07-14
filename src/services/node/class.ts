import { BifrostNode }      from '@frostr/bifrost'
import { EventEmitter }     from '@vbyte/micro-lib'
import { Assert }           from '@vbyte/micro-lib/assert'
import { GlobalController } from '@/core/global.js'
import { decrypt_secret }   from '@/lib/crypto.js'
import { decode_share }     from '@/lib/encoder.js'
import { logger }           from '@/logger.js'

import {
  SYMBOLS,
  DISPATCH_TIMEOUT
} from '@/const.js'

import {
  handle_node_message,
  handle_settings_updates
} from './handler.js'

import {
  get_node_state,
  get_node_status,
  has_node_config
} from './lib.js'

import {
  attach_console,
  attach_debugger,
  attach_hooks,
  ping_peers,
  start_bifrost_node
} from './startup.js'

import type {
  GlobalInitScope,
  BifrostState
} from '@/types/index.js'

const LOG    = logger('node')
const DOMAIN = SYMBOLS.DOMAIN.NODE
const TOPIC  = SYMBOLS.TOPIC.NODE

const DEFAULT_STATE : () => BifrostState = () => {
  return {
    peers  : [],
    pubkey : null,
    status : 'loading'
  }
}

export class BifrostController extends EventEmitter <{
  unlock : [ state : BifrostState ]
  ready  : any[]
  reset  : [ state : BifrostState ]
  closed : any[]
  error  : [ error : unknown ]
}> {
  private readonly _global : GlobalController

  private _client : BifrostNode    | null = null
  private _timer  : NodeJS.Timeout | null = null
  private _reconnectTimer : NodeJS.Timeout | null = null
  private _keepAliveTimer : NodeJS.Timeout | null = null
  private _reconnectAttempts : number = 0
  private _maxReconnectAttempts : number = 10
  private _reconnectDelay : number = 1000 // Start with 1 second
  private _keepAliveInterval : number = 30000 // 30 seconds
  private _isVisible : boolean = true

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
    // Set up page visibility handling
    this._setupPageVisibilityHandling()
    LOG.debug('controller installed')
  }

  private _setupPageVisibilityHandling() {
    // Listen for page visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this._isVisible = !document.hidden
        LOG.info(`page visibility changed: ${this._isVisible ? 'visible' : 'hidden'}`)
        
        if (this._isVisible) {
          // Page became visible - check connection and reconnect if needed
          this._handlePageVisible()
        } else {
          // Page became hidden - prepare for potential disconnection
          this._handlePageHidden()
        }
      })
    }
  }

  private _handlePageVisible() {
    LOG.info('page became visible, checking connection health')
    // Reset reconnection attempts when page becomes visible
    this._reconnectAttempts = 0
    
    // If we have a client but it's not ready, try to reconnect
    if (this._client && !this._client.is_ready) {
      LOG.info('connection appears dead, attempting reconnection')
      this._attemptReconnection()
    } else if (!this._client && this.can_start) {
      LOG.info('no client found, starting new connection')
      this._start()
    }
    
    // Resume keep-alive pings
    this._startKeepAlive()
  }

  private _handlePageHidden() {
    LOG.info('page became hidden, preparing for background mode')
    // Don't immediately disconnect, but prepare for reconnection when visible again
    // Keep the connection alive but reduce keep-alive frequency
    this._stopKeepAlive()
    
    // Register background sync for when connection fails
    this._registerBackgroundSync()
  }

  private _registerBackgroundSync() {
    // Register background sync to help with reconnection
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(registration => {
        if ('sync' in registration) {
          // @ts-ignore - sync types are not fully defined
          registration.sync.register('keep-alive-sync').then(() => {
            LOG.info('background sync registered for keep-alive')
          }).catch((err: any) => {
            LOG.warn('failed to register background sync:', err)
          })
        }
      }).catch((err: any) => {
        LOG.warn('service worker not ready for background sync:', err)
      })
    }
  }

  private _attemptReconnection() {
    // Clear any existing reconnection timer
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }

    // Don't attempt reconnection if we've exceeded max attempts
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      LOG.error('max reconnection attempts reached, giving up')
      return
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(this._reconnectDelay * Math.pow(2, this._reconnectAttempts), 30000)
    this._reconnectAttempts++

    LOG.info(`attempting reconnection ${this._reconnectAttempts}/${this._maxReconnectAttempts} in ${delay}ms`)

    this._reconnectTimer = setTimeout(() => {
      if (this.can_start) {
        try {
          // Clean up existing client
          if (this._client) {
            this._client = null
          }
          
          // Start new connection
          this._start()
          LOG.info('reconnection attempt initiated')
        } catch (err) {
          LOG.error('reconnection attempt failed:', err)
          // Register background sync for potential recovery
          this._onConnectionFailed()
          // Try again after delay
          this._attemptReconnection()
        }
      }
    }, delay)
  }

  private _onConnectionFailed() {
    // Register background sync when connection fails
    this._registerBackgroundSync()
  }

  private _startKeepAlive() {
    this._stopKeepAlive()
    
    if (!this._client || !this._client.is_ready) return

    this._keepAliveTimer = setInterval(() => {
      if (this._client && this._client.is_ready) {
        // Send ping to all peers to keep connection alive
        this._client.peers.forEach(peer => {
          if (peer.status === 'online') {
            this._client?.req.ping(peer.pubkey).catch(err => {
              LOG.warn('keep-alive ping failed:', err)
            })
          }
        })
        LOG.debug('keep-alive pings sent')
      }
    }, this._keepAliveInterval)
  }

  private _stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer)
      this._keepAliveTimer = null
    }
  }

  get can_start () : boolean {
    const share = this.global.scope.private.share
    return this.has_config && !!share
  }

  get client () : BifrostNode {
    Assert.exists(this._client, 'node client called before start')
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

  get is_ready () : boolean {
    return this._client?.is_ready ?? false
  }

  get state () : BifrostState {
    return get_node_state(this)
  }

  get status () : string {
    return get_node_status(this)
  }

  get isVisible () : boolean {
    return this._isVisible
  }

  set client (client : BifrostNode | null) {
    this._client = client
  }

  // Public method to trigger reconnection
  public attemptReconnection() {
    this._attemptReconnection()
  }

  // Public method to start keep-alive
  public startKeepAlive() {
    this._startKeepAlive()
  }

  // Public method to stop keep-alive
  public stopKeepAlive() {
    this._stopKeepAlive()
  }

  // Public method to start the node connection
  public start() {
    this._start()
  }

  // Debug method to get connection info
  public getConnectionInfo() {
    return {
      isVisible: this._isVisible,
      isReady: this.is_ready,
      canStart: this.can_start,
      reconnectAttempts: this._reconnectAttempts,
      maxReconnectAttempts: this._maxReconnectAttempts,
      hasClient: !!this._client,
      clientReady: this._client?.is_ready || false,
      status: this.status,
      peers: this._client?.peers || []
    }
  }

  _dispatch () {
    // If the timer is not null, clear it.
    if (this._timer) clearTimeout(this._timer)
    // Set the timer to dispatch the payload.
    this._timer = setTimeout(() => {
      // Send a node status event.
      this.global.mbus.publish({
        domain  : DOMAIN,
        topic   : TOPIC.EVENT,
        payload : this.state
      })
    }, DISPATCH_TIMEOUT)
  }

  _start () {
    // If the node is not ready, return.
    if (!this.can_start) return
    // If the node is already initialized, return.
    LOG.info('starting bifrost node')
    try {
      // Initialize the node.
      this._client = start_bifrost_node(this)
      // Configure the ready event.
      this.client.once('ready', () => {
        // Reset reconnection attempts on successful connection
        this._reconnectAttempts = 0
        // Attach the listeners.
        attach_hooks(this)
        // Attach the console.
        attach_console(this)
        // Attach the debugger.
        attach_debugger(this)
        // Ping the peers.
        ping_peers(this)
        // Start keep-alive mechanism
        this._startKeepAlive()
        // Emit the ready event.
        this.emit('ready')
        // Log the ready event.
        LOG.info('bifrost node ready')
      })
      // Handle connection errors with reconnection
      this.client.on('error', (err) => {
        LOG.error('bifrost node error:', err)
        if (this._isVisible) {
          this._attemptReconnection()
        }
      })
      // Connect the node.
      this.client.connect()
    } catch (err) {
      // Log the error.
      LOG.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
      // Attempt reconnection if page is visible
      if (this._isVisible) {
        this._attemptReconnection()
      }
    }
  }

  init () {
    // Log the initialization.
    LOG.info('service initializing')
    // Subscribe to node messages.
    this.global.mbus.subscribe((msg) => handle_node_message(this, msg))
    // Subscribe to settings updates.
    this.global.service.settings.on('update', (current, updated) => {
      handle_settings_updates(this, current, updated)
    })
    // Log the initialization.
    LOG.info('service activated')
  }

  reset () {
    // Clean up timers
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    this._stopKeepAlive()
    
    // Reset reconnection attempts
    this._reconnectAttempts = 0
    
    // Reset the node.
    this.client = null
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
    const share = this.global.service.settings.data.share
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
