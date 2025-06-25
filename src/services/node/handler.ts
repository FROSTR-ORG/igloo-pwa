import { BifrostController } from './class.js'
import { should_reset_node } from './lib.js'
import * as CONST            from '@/const.js'

import type {
  MessageEnvelope,
  AppSettings
} from '@/types/index.js'

const NODE_TOPIC = CONST.SYMBOLS.TOPIC.NODE

export function handle_node_message (
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
