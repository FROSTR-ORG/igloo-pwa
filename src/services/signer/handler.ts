import { parse_error }      from '@vbyte/micro-lib/util'
import { SignerController } from './class.js'
import { SYMBOLS }          from '@/const.js'
import { logger }           from '@/logger.js'

import type { RequestMessage } from '@/types/index.js'

const LOG    = logger('signer')
const DOMAIN = SYMBOLS.DOMAIN.SIGNER
const TOPIC  = SYMBOLS.TOPIC.SIGNER

export async function handle_signer_message (
  self : SignerController,
  msg  : RequestMessage
) {
  // If the message is not for this domain, return.
  if (msg.domain !== DOMAIN) return
  // Try to handle the signer message.
  try {
    // Handle the signer message.
    switch (msg.topic) {
      case TOPIC.FETCH: {
        const state = self.fetch()
        if (state) self.global.mbus.accept(msg.id, state)
        else self.global.mbus.reject(msg.id, 'signer not initialized')
        break
      }
      case TOPIC.RESET: {
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
    // Log the error.
    LOG.error('error handling signer message:', err)
  }
}
