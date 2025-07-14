import { BifrostNode }        from '@frostr/bifrost'
import { Assert }             from '@vbyte/micro-lib/assert'
import { sanitize_payload }   from '@/lib/message.js'
import { BifrostController }  from './class.js'
import { get_peer_configs }   from '@/lib/peers.js'
import { SYMBOLS }            from '@/const.js'
import { logger }             from '@/logger.js'

import type { LogType } from '@/types/console.js'

const LOG    = logger('node')
const DOMAIN = SYMBOLS.DOMAIN.NODE

export function start_bifrost_node (self : BifrostController) {
  // If the node cannot be initialized, return an error.
  Assert.ok(self.can_start, 'node is not ready to start')
  // Get the share from the settings.
  const share = self.global.scope.private.share
  // If the share is not present, return an error.
  Assert.exists(share, 'share not present')
  // Get the settings cache.
  const settings = self.global.service.settings.data
  // Extract the urls from the relay policies.
  const urls = settings.relays.map(e => e.url)
  // Get the peer policies.
  const policies = get_peer_configs(settings)
  // Initalize the bifrost node.
  return new BifrostNode(settings.group!, share, urls, { policies })
}

export function attach_hooks (self : BifrostController) {
  // If the node client is not initialized, return an error.
  Assert.exists(self.client, 'node client not initialized')
  // Update the node state on any event.
  self.client.on('*', () => { self._dispatch() })
  // Update the node state on changes to the settings.
  self.global.service.settings.on('update', () => { self._dispatch() })
  // Hook into the closed event with reconnection logic.
  self.client.on('closed', () => {
    // Emit the closed event.
    self.emit('closed')
    // Log the node closed event.
    LOG.info('node closed')
    // Attempt reconnection if page is visible
    if (self.isVisible) {
      LOG.info('attempting reconnection after close event')
      self.attemptReconnection()
    }
  })
  // Hook into connection errors
  self.client.on('error', (err) => {
    LOG.error('node connection error:', err)
    // Let the main _start() method handle this
  })
}

export function attach_debugger (self : BifrostController) {
  // If the node client is not initialized, return an error.
  Assert.exists(self.client, 'node client not initialized')
  // Listen for node events.
  self.client.on('*', (event, data) => {
    switch (true) {
      case event === 'message':
        LOG.debug('received message', data)
        break
      case event.startsWith('/ping/req'):
        LOG.debug('received ping', data)
    }
  })
}

export function attach_console (self : BifrostController) {
  // If the node client is not initialized, return an error.
  Assert.exists(self.client, 'node client not initialized')
  // Get the console service.
  const console = self.global.service.console
  // Listen for node events.
  self.client.on('*', (event, data) => {
    // Initialize variables for the log entry.
    let message : string | undefined
    let payload : any     = data
    let type    : LogType = 'info'
    // Based on a true match, set the message and type.
    switch (true) {
      case event.startsWith('/ecdh/handler/req'):
        message = 'node recieved ecdh request'
        type    = 'info'
        break
      case event.startsWith('/ecdh/sender/req'):
        message = 'node is sending ecdh request'
        type    = 'info'
        break
      case event.startsWith('/sign/handler/req'):
        message = 'node recieved sign request'
        type    = 'info'
        break
      case event.startsWith('/sign/sender/req'):
        message = 'node is sending sign request'
        type    = 'info'
        break
    }
    // If no message is set, return.
    if (!message) return
    // If payload is an empty object,
    if (typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0) {
      // Set it to undefined so no dropdown is shown
      payload = undefined
    } else if (payload instanceof BifrostNode || payload instanceof Error) {
      // Set it to undefined so no dropdown is shown
      payload = undefined
    } else {
      // Sanitize the payload.
      payload = sanitize_payload(payload)
    }
    // Add the log entry.
    console.add({
      domain  : DOMAIN,
      message : message,
      payload : payload,
      type    : type
    })
  })
}

export function ping_peers (self : BifrostController) {
  // If the node client is not initialized, return an error.
  Assert.exists(self.client, 'node client not initialized')
  // Listen for node events.
  self.client.peers.forEach(peer => {
    if (peer.status !== 'online') {
      self.client?.req.ping(peer.pubkey)
    }
  })
}
