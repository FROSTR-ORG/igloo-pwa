import { parse_error } from '@vbyte/micro-lib/util'
import * as CONST      from '@/const.js'
import { logger }      from '@/logger.js'

import type { SessionController } from './class.js'
import type { RequestMessage }    from '@/types/index.js'

import type {
  InviteToken,
  SignerSession
} from '@cmdcode/nostr-connect'

const LOG    = logger('session')
const DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION
const TOPIC  = CONST.SYMBOLS.TOPIC.SESSION

export async function handle_session_message (
  self : SessionController,
  msg  : RequestMessage
) {
  try {
    // If the message is not for this domain, return.
    if (msg.domain !== DOMAIN) return
    // Handle the session message.
    switch (msg.topic) {
      case TOPIC.CONNECT: {
        self.connect(msg.params as InviteToken)
          .then(() => self.global.mbus.accept(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
      case TOPIC.FETCH: {
        if (self.state) self.global.mbus.accept(msg.id, self.state)
        else self.global.mbus.reject(msg.id, 'signer not initialized')
        break
      }
      case TOPIC.CLEAR: {
        self.clear()
          .then(() => self.global.mbus.accept(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
      case TOPIC.REVOKE: {
        self.revoke(msg.params as string)
          .then(() => self.global.mbus.accept(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
      case TOPIC.UPDATE: {
        self.update(msg.params as SignerSession)
          .then(() => self.global.mbus.accept(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
    }
  } catch (err) {
    // If the error is not a string, parse it.
    const reason = parse_error(err)
    // Reject the message.
    self.global.mbus.reject(msg.id, reason)
    // Log the error.
    LOG.error('session request error:', reason)
  }
}
