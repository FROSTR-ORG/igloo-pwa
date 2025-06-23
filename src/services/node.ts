import { BifrostNode }           from '@frostr/bifrost'
import { EventEmitter }          from '@/class/emitter.js'
import { GlobalController }      from '@/core/global.js'
import { Assert, JsonUtil }      from '@/util/index.js'
import * as CONST                from '@/const.js'

import {
  attach_node_logger,
  get_console
} from '@/lib/logger.js'

import {
  get_peer_policies,
  init_peer_permissions,
  should_init_peers
} from '@/lib/node.js'

import type {
  MessageEnvelope,
  ApplicationSettings,
  GlobalInitScope,
  NodeState
} from '@/types/index.js'

const NODE_DOMAIN = CONST.SYMBOLS.DOMAIN.NODE
const NODE_TOPIC  = CONST.SYMBOLS.TOPIC.NODE

export class BifrostController extends EventEmitter <{
  ready : any[]
}> {
  private readonly _global : GlobalController

  private _client : BifrostNode | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
    this.global.mbus.subscribe(this._handler.bind(this), { domain : NODE_DOMAIN })
  }

  get can_init () : boolean {
    const enclave = this.global.scope.enclave
    return this.has_settings && enclave.is_ready
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

  get log () {
    return get_console('[ node ]')
  }

  get state () : NodeState {
    return {
      peers  : this.client?.peers ?? [],
      pubkey : this.client?.pubkey ?? null,
      status : get_node_status(this)
    }
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

  async _init () {
    if (this.can_init) {
      const err = init_node(this)
      if (!err) {
        this._dispatch(this.state)
        this.log.info('client initialized')
        this.emit('ready')
      } else {
        this.log.error('failed to initialize client:', err)
      }
    }
  }

  init () {
    // Subscribe to node messages.
    this.global.mbus.subscribe(msg => handle_node_message(this, msg))
    // Subscribe to settings changes.
    this.global.scope.settings.on_change(handle_peer_updates)
    // Subscribe to settings updates.
    this.global.scope.settings.on('update', (current, updated) => {
      handle_settings_updates(this, current, updated)
    })
    // Subscribe to enclave updates.
    this.global.scope.enclave.on('unlocked', () => this._init())
    // Initialize the node.
    this._init()
  }
}

function get_node_status (node : BifrostController) : string {
  if (node.client?.is_ready) return 'online'
  if (node.client)           return 'connecting'
  return 'offline'
}

function handle_node_message (
  ctrl : BifrostController,
  msg  : MessageEnvelope
) {
  // If the message is not a request, return.
  if (msg.type !== 'request') return
  // Handle the node message.
  switch (msg.topic) {
    // For echo requests,
    case NODE_TOPIC.ECHO: {
      // If the client is not initialized, return an error.
      if (!ctrl.client) return ctrl.global.mbus.reject(msg.id, 'client not initialized')
      // Send an echo request.
      ctrl.client.req.echo(msg.params as string).then(res => {
        // If the ping failed, return an error.
        if (!res.ok) return ctrl.global.mbus.reject(msg.id, res.err)
        // Respond with the result.
        ctrl.global.mbus.respond(msg.id, true)
      })
      break
    }
    // For fetch requests,
    case NODE_TOPIC.FETCH: {
      // Respond with the result.
      ctrl.global.mbus.respond(msg.id, ctrl.state)
      break
    }
    // For ping requests,
    case NODE_TOPIC.PING: {
      // If the client is not initialized, return an error.
      if (!ctrl.client) return ctrl.global.mbus.reject(msg.id, 'client not initialized')
      // Ping the peer.
      ctrl.client.req.ping(msg.params as string).then(res => {
        // If the ping failed, return an error.
        if (!res.ok) return ctrl.global.mbus.reject(msg.id, res.err)
        // Respond with the result.
        ctrl.global.mbus.respond(msg.id, true)
      })
      break
    }
    // For reset requests,
    case NODE_TOPIC.RESET: {
      // Initialize the client.
      const err = init_node(ctrl)
      // If error, return an error.
      if (err) return ctrl.global.mbus.reject(msg.id, err)
      // Send a response.
      ctrl.global.mbus.respond(msg.id, true)
      break
    }
  }
}

function init_node (ctrl : BifrostController) {
  try {
    // If the node cannot be initialized, return an error.
    if (!ctrl.has_settings) return 'node is not configured'
    // Get the enclave.
    const enclave = ctrl.global.scope.enclave
    // If the enclave is not ready, return an error.
    if (!enclave || !enclave.is_ready) return 'enclave not ready'
    // Get the share from the enclave.
    const share = enclave.store.share
    // If the share is not present, return an error.
    if (!share) return 'share not present'
    // If the store is missing data, return early.
    if (!share || !ctrl.can_init) {
      return 'store is not fully initialized'
    }
    // Get the settings cache.
    const settings = ctrl.global.scope.settings.data
    // Extract the urls from the relay policies.
    const urls = settings.relays.map(e => e.url)
    // Get the peer policies.
    const policies = get_peer_policies(settings.peers)
    // Initalize the bifrost node.
    const node = new BifrostNode(settings.group!, share, urls, { policies })
    // Attach the logger to the node.
    attach_node_logger(ctrl.global.scope.log, node)
    // Connect the node.
    node.connect()
    // Update the global state.
    ctrl.client = node
    // Return null for success.
    return null
  } catch (err) {
    // Log the error.
    console.error(err)
    // Return an error response.
    return 'error during initialization'
  }
}

function handle_peer_updates (
  current : ApplicationSettings,
  updated : ApplicationSettings
) : ApplicationSettings {
  if (should_init_peers(current, updated)) {
    // Initialize the peer permissions.
    const peers = init_peer_permissions(updated)
    // Update the global state.
    return { ...updated, peers }
  }
  // Return the updated settings.
  return updated
}

function handle_settings_updates (
  ctrl    : BifrostController,
  current : ApplicationSettings,
  updated : ApplicationSettings
) {
  // Check if we should reset the node.
  const is_reset = should_reset_node(ctrl, current, updated)
  // If we should, reset the node.
  if (is_reset) {
    // If we can initialize,
    if (ctrl.can_init) {
      // Load the node.
      init_node(ctrl)
    } else {
      // Reset the node.
      ctrl.client = null
    }
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
  ctrl    : BifrostController,
  current : ApplicationSettings,
  updated : ApplicationSettings
) {
  // If we can't initialize, then return false.
  if (!ctrl.global.scope.private) return false
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
