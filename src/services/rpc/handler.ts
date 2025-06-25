import { Assert }        from '@vbyte/micro-lib/assert'
import { RpcController } from './class'
import * as CONST        from '@/const.js'
import { CONST as NC }   from '@cmdcode/nostr-connect'

import {
  ConnectionToken,
  RequestMessage,
  SessionToken
} from '@cmdcode/nostr-connect'

import type { MessageEnvelope } from '@/types/index.js'
import { parse_error } from '@vbyte/micro-lib/util'

const SESSION_DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION
const SESSION_TOPIC  = CONST.SYMBOLS.TOPIC.SESSION
const SIGN_METHOD    = NC.SIGN_METHOD

export async function handle_session_message (
  self : RpcController,
  msg  : MessageEnvelope
) {
  try {
    // If the message is not a request, return.
    if (msg.type !== 'request') return
    // Handle the session message.
    switch (msg.topic) {
      case SESSION_TOPIC.CONNECT: {
        self.connect(msg.params as ConnectionToken)
          .then(() => self.global.mbus.respond(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
      case SESSION_TOPIC.FETCH: {
        const state = self.fetch()
        if (state) self.global.mbus.respond(msg.id, state)
        else self.global.mbus.reject(msg.id, 'rpc client not initialized')
        break
      }
      case SESSION_TOPIC.RESET: {
        self.reset()
        self.global.mbus.respond(msg.id, true)
        break
      }
      case SESSION_TOPIC.REVOKE: {
        self.revoke(msg.params as string)
          .then(() => self.global.mbus.respond(msg.id, true))
          .catch(err => self.global.mbus.reject(msg.id, err))
        break
      }
      case SESSION_TOPIC.UPDATE: {
        self.update(msg.params as SessionToken)
          .then(() => self.global.mbus.respond(msg.id, true))
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
    self.log.error('session request error:', reason)
  }
}

export async function handle_signer_request (
  self  : RpcController,
  req   : RequestMessage,
  token : SessionToken
) {
  try {
    // If the session or signer is not initialized, return.
    Assert.exists(self.client,  'client not initialized')
    Assert.exists(self.session, 'session not initialized')
    Assert.exists(self.signer,  'signer not initialized')
    // Get the message bus service.
    const mbus = self.global.mbus
    // Get the methods from the signer.
    const methods = self.signer.get_methods()
    // Get the session permissions.
    const perms   = token.perms ?? {}
    // If the method is not supported, return early.
    if (!methods.includes(req.method)) {
      const reason = 'method not supported: ' + req.method
      handle_signer_reject(self, req, reason)
      return
    }
    // If the session does not have permissions, return early.
    if (!perms[req.method]) {
      const reason = 'session does not have permissions: ' + req.method
      handle_signer_reject(self, req, reason)
      return
    }
    // Try to handle the request.
    if (req.method === SIGN_METHOD.SIGN_EVENT) {
      // Get the event permissions.
      const event_perms = perms.sign_event
      // If the event permissions are not an array, return early.
      if (!Array.isArray(event_perms)) {
        const reason = 'event permissions missing'
        handle_signer_reject(self, req, reason)
        return
      }
      // Get the event.
      const json = req.params.at(0)
      // If the event is not a string, return early.
      if (!json) return
      // Parse the event.
      const event  = JSON.parse(json)
      // If the event kind is not in the event permissions, return early.
      if (!event_perms.includes(event.kind)) {
        const reason = 'event kind not allowed: ' + event.kind
        handle_signer_reject(self, req, reason)
        return
      }
      // Sign the event.
      const signed = await self.signer.sign_event(event)
      // If the signer failed, return early.
      if (!signed) {
        const reason = 'failed to sign event'
        handle_signer_reject(self, req, reason)
        return
      }
      // Respond to the request.
      handle_signer_response(self, req, JSON.stringify(signed))
    }

    if (req.method === SIGN_METHOD.NIP04_DECRYPT) {
      // Get the peer pubkey and ciphertext.
      const peer_pubkey = req.params.at(0)
      const ciphertext  = req.params.at(1)
      // If the peer pubkey or ciphertext is missing,.
      if (!peer_pubkey || !ciphertext) {
        // Reject the request.
        const reason = 'peer pubkey or ciphertext missing'
        handle_signer_reject(self, req, reason)
        return
      }
      // Decrypt the ciphertext.
      const decrypted = await self.signer.nip04_decrypt(peer_pubkey, ciphertext)
      // Respond to the request.
      handle_signer_response(self, req, decrypted)
    }

    if (req.method === SIGN_METHOD.NIP04_ENCRYPT) {
      // Get the peer pubkey and plaintext.
      const peer_pubkey = req.params.at(0)
      const plaintext   = req.params.at(1)
      // If the peer pubkey or plaintext is missing, return early.
      if (!peer_pubkey || !plaintext) {
        // Reject the request.
        const reason = 'peer pubkey or plaintext missing'
        handle_signer_reject(self, req, reason)
        return
      }
      // Encrypt the plaintext.
      const encrypted = await self.signer.nip04_encrypt(peer_pubkey, plaintext)
      // Respond to the request.
      handle_signer_response(self, req, encrypted)
    }

    if (req.method === SIGN_METHOD.NIP44_DECRYPT) {
      // Get the peer pubkey and ciphertext.
      const peer_pubkey = req.params.at(0)
      const ciphertext  = req.params.at(1)
      // If the peer pubkey or ciphertext is missing, return early.
      if (!peer_pubkey || !ciphertext) {
        // Reject the request.
        const reason = 'peer pubkey or ciphertext missing'
        handle_signer_reject(self, req, reason)
        return
      }
      // Decrypt the ciphertext.
      const decrypted = await self.signer.nip44_decrypt(peer_pubkey, ciphertext)
      // Respond to the request.
      handle_signer_response(self, req, decrypted)
    }

    if (req.method === SIGN_METHOD.NIP44_ENCRYPT) {
      // Get the peer pubkey and plaintext.
      const peer_pubkey = req.params.at(0)
      const plaintext   = req.params.at(1)
      // If the peer pubkey or plaintext is missing, return early.
      if (!peer_pubkey || !plaintext) {
        // Reject the request.
        const reason = 'peer pubkey or plaintext missing'
        handle_signer_reject(self, req, reason)
        return
      }
      // Encrypt the plaintext.
      const encrypted = await self.signer.nip44_encrypt(peer_pubkey, plaintext)
      // Respond to the request.
      handle_signer_response(self, req, encrypted)
    }
  } catch (err) {
    // If the error is not a string, parse it.
    const reason = parse_error(err)
    // Reject the request.
    handle_signer_reject(self, req, reason)
  }
}

function handle_signer_response (
  self : RpcController,
  req  : RequestMessage,
  data : any
) {
  // Assert that the client is initialized.
  Assert.exists(self.client, 'client not initialized')
  // Respond to the request.
  self.client.respond(req.id, req.env.pubkey, data)
  // Respond to the message bus.
  self.global.mbus.respond(req.id, true)
  // Log the response.
  self.log.info('signer response:', req.id)
  // Log the response to the console.
  self.global.service.console.add({
    topic   : SESSION_DOMAIN,
    message : 'session request fulfilled: ' + req.method
  })
}

function handle_signer_reject (
  self   : RpcController,
  req    : RequestMessage,
  reason : string
) {
  // Assert that the client and session are initialized.
  Assert.exists(self.client,  'client not initialized')
  Assert.exists(self.session, 'session not initialized')
  // Send a rejection to the nostr client.
  self.client.reject(req.id, req.env.pubkey, reason)
  // Reject the request.
  self.global.mbus.reject(req.id, reason)
  // Log the error.
  self.log.error('signer request rejected:', reason)
  // Log the error to the console.
  self.global.service.console.add({
    topic   : SESSION_DOMAIN,
    message : 'session request rejected: ' + reason
  })
}