import { parse_error }      from '@vbyte/micro-lib/util'
import { SignerController } from './class.js'
import * as CONST           from '@/const.js'
import { logger }           from '@/logger.js'

import type { RequestMessage } from '@/types/index.js'

const LOG          = logger('signer')
const SIGNER_TOPIC = CONST.SYMBOLS.TOPIC.SIGNER

export async function handle_signer_message (
  self : SignerController,
  msg  : RequestMessage
) {
  try {
    // Handle the signer message.
    switch (msg.topic) {
      case SIGNER_TOPIC.FETCH: {
        const state = self.fetch()
        if (state) self.global.mbus.accept(msg.id, state)
        else self.global.mbus.reject(msg.id, 'signer not initialized')
        break
      }
      case SIGNER_TOPIC.RESET: {
        self.reset()
        self.global.mbus.accept(msg.id, true)
        break
      }
    }
  } catch (err) {
    // If the error is not a string, parse it.
    const reason = parse_error(err)
    // Reject the message.
    self.global.mbus.reject(msg.id, reason)
    // Emit the error event.
    self.emit('error', err)
    // Log the error.
    LOG.error('signer request error:', err)
  }
}
