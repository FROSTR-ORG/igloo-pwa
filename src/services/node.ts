import { BifrostNode }        from '@frostr/bifrost'
import { create_logger }      from '@vbyte/micro-lib/logger'
import { EventEmitter }       from '@/class/emitter.js'
import { CoreController }     from '@/core/ctrl.js'
import { Assert, JsonUtil }   from '@/util/index.js'
import { decrypt_secret }     from '@/lib/crypto.js'
import { decode_share }       from '@/lib/encoder.js'
import { get_peer_configs }   from '@/lib/node.js'
import { attach_node_logger } from '@/lib/logger.js'
import * as CONST             from '@/const.js'

import type {
  MessageEnvelope,
  AppSettings,
  GlobalInitScope,
  NodeState
} from '@/types/index.js'

const NODE_DOMAIN = CONST.SYMBOLS.DOMAIN.NODE
const NODE_TOPIC  = CONST.SYMBOLS.TOPIC.NODE

export class BifrostController extends EventEmitter <{
  unlock : [ state : NodeState ]
  ready  : any[]
  reset  : [ state : NodeState ]
  closed : any[]
  error  : [ error : unknown ]
}> {
  private readonly _global : CoreController

  private _client : BifrostNode | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = CoreController.fetch(scope)
  }

  get can_init () : boolean {
    const share = this.global.scope.private.share
    return this.has_settings && !!share
  }

  get client () : BifrostNode | null {
    return this._client
  }

  get global () {
    return this._global
  }

  get has_settings () : boolean {
    return has_node_settings(this)
  }

  get has_share () : boolean {
    return !!this.global.scope.private.share
  }

  get is_ready () : boolean {
    return this.client?.is_ready ?? false
  }

  get log () {
    return create_logger('node')
  }

  get state () : NodeState {
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

  _dispatch (payload : NodeState) {
    // Send a node status event.
    this.global.mbus.send({ topic: NODE_TOPIC.EVENT, payload })
  }

  _handler (msg : MessageEnvelope) {
    if (msg.type !== 'request') return
    handle_node_message(this, msg)
  }

  _start () {
    try {
      // If the node cannot be initialized, return an error.
      Assert.ok(this.has_settings, 'node is not configured')
      // Get the share from the settings.
      const share = this.global.scope.private.share
      // If the share is not present, return an error.
      Assert.exists(share, 'share not present')
      // If the store is missing data, return early.
      Assert.ok(this.can_init, 'store is not fully initialized')
      // Get the settings cache.
      const settings = this.global.scope.settings.data
      // Extract the urls from the relay policies.
      const urls = settings.relays.map(e => e.url)
      // Get the peer policies.
      const policies = get_peer_configs(settings)
      // Initalize the bifrost node.
      const node = new BifrostNode(settings.group!, share, urls, { policies })
      // Attach the logger to the node.
      attach_node_logger(this.global.scope.log, node)
      // Dispatch the node state.
      node.on('ready',  () => {
        // Dispatch the node state.
        this._dispatch(this.state)
        // Emit the ready event.
        this.emit('ready')
        // Log the node ready event.
        this.log.info('node ready')
      })
      node.on('closed', () => {
        // Dispatch the node state.
        this._dispatch(this.state)
        // Emit the closed event.
        this.emit('closed')
        // Log the node closed event.
        this.log.info('node closed')
      })
      node.on('/ping/handler/res', () => {
        // Dispatch the node state.
        this._dispatch(this.state)
      })
      // Connect the node.
      node.connect()
      // Update the global state.
      this.client = node
    } catch (err) {
      // Log the error.
      this.log.error('error during initialization:', err)
      // Emit the error event.
      this.emit('error', err)
    }
  }

  init () {
    // Subscribe to node messages.
    this.global.mbus.subscribe(msg => handle_node_message(this, msg))
    // Subscribe to settings updates.
    this.global.scope.settings.on('update', (current, updated) => {
      handle_settings_updates(this, current, updated)
    })
    // Log the initialization.
    this.log.info('initialized')
  }

  reset () {
    // Reset the node.
    this.client = null
    // Dispatch the node state.
    this._dispatch(this.state)
    // Emit the reset event.
    this.emit('reset', this.state)
  }

  unlock (password : string) {
    // If password is not a string, return error.
    if (typeof password !== 'string') return 'password is not a string'
    // Get the share from the settings.
    const share = this.global.scope.settings.data.share
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
    this.global.scope.private.share = parsed
    // Emit the unlock event.
    this.emit('unlock', this.state)
    // Log the unlock event.
    this.log.info('node unlocked')
    // Run the node boot process.
    this._start()
  }
}

function get_node_status (node : BifrostController) : string {
  if (node.is_ready)           return 'online'
  if (node.client)             return 'connecting'
  if (node.has_share)          return 'unlocked'
  if (has_node_settings(node)) return 'locked'
  return 'loading'
}

function handle_node_message (
  self : BifrostController,
  msg  : MessageEnvelope
) {
  // If the message is not a request, return.
  if (msg.type !== 'request') return
  // Handle the node message.
  switch (msg.topic) {
    // For echo requests,
    case NODE_TOPIC.ECHO: {
      // If the client is not initialized, return an error.
      if (!self.client) return self.global.mbus.reject(msg.id, 'client not initialized')
      // Send an echo request.
      self.client.req.echo(msg.params as string).then(res => {
        // If the ping failed, return an error.
        if (!res.ok) return self.global.mbus.reject(msg.id, res.err)
        // Respond with the result.
        self.global.mbus.respond(msg.id, true)
      })
      break
    }
    // For fetch requests,
    case NODE_TOPIC.FETCH: {
      // Respond with the result.
      self.global.mbus.respond(msg.id, self.state)
      break
    }
    // For ping requests,
    case NODE_TOPIC.PING: {
      // If the client is not initialized, return an error.
      if (!self.client) return self.global.mbus.reject(msg.id, 'client not initialized')
      // Ping the peer.
      self.client.req.ping(msg.params as string).then(res => {
        // Dispatch the node state.
        self._dispatch(self.state)
        // Return the result.
        if (res.ok) self.global.mbus.respond(msg.id, true)
        else self.global.mbus.reject(msg.id, res.err)
      })
      break
    }
    // For reset requests,
    case NODE_TOPIC.RESET: {
      // Reset the node.
      self.reset()
      // Send a response.
      self.global.mbus.respond(msg.id, true)
      break
    }
    // For unlock requests,
    case NODE_TOPIC.UNLOCK: {
      // Unlock the node.
      self.unlock(msg.params as string)
      // Send a response.
      self.global.mbus.respond(msg.id, true)
      break
    }
  }
}

function handle_settings_updates (
  self    : BifrostController,
  current : AppSettings,
  updated : AppSettings
) {
  // Check if we should reset the node.
  if (should_reset_node(self, current, updated)) {
    // Reset the node.
    self.reset()
  }
}

function has_node_settings (ctrl : BifrostController) : boolean {
  // Get the settings cache.
  const settings = ctrl.global.scope.settings.data
  // Unpack store object.
  const { group, relays, share } = settings
  // Test if the store has the required data to initialize.
  return !!group && !!share && relays.length > 0
}

function should_reset_node (
  self    : BifrostController,
  current : AppSettings,
  updated : AppSettings
) {
  // If we can't initialize, then return false.
  if (!self.global.scope.private) return false
  // If the share data has changed, return false.
  if (current.share !== updated.share) return false
  // If the group data has changed, return true.
  if (current.group !== updated.group) return true
  // If the relay policy has changed, return true.
  if (!JsonUtil.is_equal(current.peers,  updated.peers))  return true
  // If the relay policy has changed, return true.
  if (!JsonUtil.is_equal(current.relays, updated.relays)) return true
  // By default, return false.
  return false
}
