import { parse_error } from '@cmdcode/nostr-p2p/util'
import { BifrostController } from './class.js'
import { should_reset_node } from './lib.js'
import { SYMBOLS }           from '@/const.js'
import { logger }            from '@/logger.js'

import type {
  AppSettings,
  RequestMessage
} from '@/types/index.js'

const LOG    = logger('node')
const DOMAIN = SYMBOLS.DOMAIN.NODE
const TOPIC  = SYMBOLS.TOPIC.NODE

export function handle_node_message (
  self : BifrostController,
  msg  : RequestMessage
) {
  // If the message is not for this domain, return.
  if (msg.domain !== DOMAIN) return
  //
  try {
    // Handle the node message.
    switch (msg.topic) {
      // For echo requests,
      case TOPIC.ECHO: {
        // If the client is not initialized, return an error.
        if (!self.client) return self.global.mbus.reject(msg.id, 'client not initialized')
        // Send an echo request.
        self.client.req.echo(msg.params as string).then(res => {
          // If the ping failed, return an error.
          if (!res.ok) return self.global.mbus.reject(msg.id, res.err)
          // Respond with the result.
          self.global.mbus.accept(msg.id, true)
        })
        break
      }
      // For fetch requests,
      case TOPIC.FETCH: {
        // Respond with the result.
        self.global.mbus.accept(msg.id, self.state)
        break
      }
      // For ping requests,
      case TOPIC.PING: {
        // If the client is not initialized, return an error.
        if (!self.client) return self.global.mbus.reject(msg.id, 'client not initialized')
        // Ping the peer.
        self.client.req.ping(msg.params as string).then(res => {
          // Return the result.
          if (res.ok) self.global.mbus.accept(msg.id, true)
          else self.global.mbus.reject(msg.id, res.err)
        })
        break
      }
      // For reset requests,
      case TOPIC.RESET: {
        // Reset the node.
        self.reset()
        // Send a response.
        self.global.mbus.accept(msg.id, true)
        break
      }
      // For unlock requests,
      case TOPIC.UNLOCK: {
        // Unlock the node.
        self.unlock(msg.params as string)
        // Send a response.
        self.global.mbus.accept(msg.id, true)
        break
      }
    }
  } catch (err) {
    // Parse the error.
    const reason = parse_error(err)
    // Send a response.
    self.global.mbus.reject(msg.id, reason)
    // Log the error.
    LOG.error('error handling node message:', err)
  }
}

export function handle_settings_updates (
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
