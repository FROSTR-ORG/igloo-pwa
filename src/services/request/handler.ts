import { parse_error } from '@vbyte/micro-lib/util'
import * as CONST      from '@/const.js'
import { logger }      from '@/logger.js'

import type { RequestController } from './class.js'
import type { RequestMessage }    from '@/types/index.js'

import type {
  EventTemplate,
  PermissionPolicy,
  PermissionRequest
} from '@cmdcode/nostr-connect'

const LOG    = logger('request')
const DOMAIN = CONST.SYMBOLS.DOMAIN.REQUEST
const TOPIC  = CONST.SYMBOLS.TOPIC.REQUEST

export async function handle_request_message (
  self : RequestController,
  msg  : RequestMessage
) {
  try {
    // If the message is not for this domain, return.
    if (msg.domain !== DOMAIN) return
    // Handle the request message.
    switch (msg.topic) {
      case TOPIC.FETCH: {
        if (self.state) self.global.mbus.accept(msg.id, self.state)
        else self.global.mbus.reject(msg.id, 'signer not initialized')
        break
      }
      case TOPIC.APPROVE: {
        self.approve(...msg.params as [ PermissionRequest, PermissionPolicy? ])
          .then(() => self.global.mbus.accept(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
      case TOPIC.DENY: {
        self.deny(...msg.params as [ PermissionRequest, string, PermissionPolicy? ])
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
    LOG.error('error handling permission request:', err)
  }
}

export async function handle_approved_request (
  self : RequestController,
  req  : PermissionRequest
) {
  const client = self.global.service.signer.client
  try {
  // Handle the request message.
    switch (req.method) {
      case 'sign_event': {
        const event  = JSON.parse(req.params?.at(0) as string)
        console.log('event', event)
        const signed = await client.signer.sign_event(event)
        console.log('signed', signed)
        const result = JSON.stringify(signed)
        client.request.resolve(req, result)
        break
      }
      case 'nip04_encrypt': {
        const [ pubkey, plaintext ] = req.params as [ string, string ]
        const result = await client.signer.nip04_encrypt(pubkey, plaintext)
        client.request.resolve(req, result)
        break
      }
      case 'nip04_decrypt': {
        const [ pubkey, ciphertext ] = req.params as [ string, string ]
        const result = await client.signer.nip04_decrypt(pubkey, ciphertext)
        client.request.resolve(req, result)
        break
      }
      case 'nip44_encrypt': {
        const [ pubkey, plaintext ] = req.params as [ string, string ]
        const result = await client.signer.nip44_encrypt(pubkey, plaintext)
        client.request.resolve(req, result)
        break
      }
      case 'nip44_decrypt': {
        const [ pubkey, ciphertext ] = req.params as [ string, string ]
        const result = await client.signer.nip44_decrypt(pubkey, ciphertext)
        client.request.resolve(req, result)
        break
      }
      default: {
        client.request.reject(req, 'unsupported method')
        break
      }
    }
  } catch (err) {
    // If the error is not a string, parse it.
    const reason = parse_error(err)
    // Reject the message.
    self.global.mbus.reject(req.id, reason)
    // Log the error.
    LOG.error('error handling signing device:', err)
  }
}
