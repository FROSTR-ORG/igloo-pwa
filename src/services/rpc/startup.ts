import { BifrostSignDevice }     from '@/class/signer.js'
import { Assert }                from '@vbyte/micro-lib/assert'
import { handle_signer_request } from './handler.js'
import { RpcController }         from './class.js'
import * as CONST                from '@/const.js'

import {
  NostrClient,
  SessionManager
} from '@cmdcode/nostr-connect'

import type {
  RequestMessage,
  SessionToken,
  SignedEvent
} from '@cmdcode/nostr-connect'

export function start_rpc_service (self : RpcController) {
  // Fetch the bifrost node from the global state.
  const node = self.global.service.node.client
  // If the node is not initialized, return an error.
  if (!node) throw new Error('bifrost node not initialized')
  // Fetch the sessions from the cache.
  const sessions = self.global.store.cache.data.sessions
  // Create a new signer.
  const signer  = new BifrostSignDevice(node)
  // Create a new client.
  const client  = new NostrClient(signer)
  // Create a new session manager.
  const session = new SessionManager(client, { sessions })
  // Return the client, session, and signer.
  return { client, session, signer }
}

export function attach_rpc_listeners (self : RpcController) {
  Assert.exists(self.session, 'session not initialized')
  // Attach the session state handler.
  self.session.on('activated', () => {
    // Update the session in the cache.
    self.global.store.cache.update({
      sessions : self.session?.active ?? []
    })
    // Dispatch the session state.
    self._dispatch()
  })
  // Attach the signer request handler.
  self.session.on('request', (
    request : RequestMessage,
    session : SessionToken
  ) => {
    console.log('handling signer request')
    handle_signer_request(self, request, session)
  })
}

export function attach_rpc_console (self : RpcController) {
  Assert.ok(self.client,  'client not initialized')
  Assert.ok(self.session, 'session not initialized')

  const console = self.global.service.console
  const topic   = CONST.SYMBOLS.DOMAIN.SESSION

  self.client.on('ready', () => {
    console.add({ message : 'session client ready', topic })
    self.log.info('session client ready')
  })

  self.client.on('error', (err : unknown) => {
    console.add({
      topic,
      message : 'session client error',
      type    : 'error',
      payload : err
    })
    self.log.error('session client error:', err)
  })

  self.client.on('close', () => {
    console.add({ message : 'session client closed', topic })
    self.log.info('session client closed')
  })

  self.session.on('activated', (session : SessionToken) => {
    console.add({ message : 'session activated', payload : session, topic })
    self.log.info('session activated:', session)
  })

  self.session.on('revoked', (session : string) => {
    console.add({ message : 'session revoked', payload : session, topic })
    self.log.info('session revoked:', session)
  })

  self.session.on('updated', (session : SessionToken) => {
    console.add({ message : 'session updated', payload : session, topic })
    self.log.info('session updated:', session)
  })

  self.session.on('request', (request : RequestMessage) => {
    console.add({
      message : 'session requested method: ' + request.method,
      topic,
    })
    self.log.info('session request:', request)
  })
  
}

export function attach_rpc_debugger (self : RpcController) {
  Assert.ok(self.client,  'client not initialized')
  Assert.ok(self.session, 'session not initialized')

  self.client.on('subscribed', () => {
    self.log.debug('session client subscribed')
  })

  self.client.on('published', (message : any) => {
    self.log.debug('session client published:', message)
  })

  self.client.on('event', (event : SignedEvent) => {
    self.log.debug('session client event:', event)
  })

  self.client.on('message', (message : any) => {
    self.log.debug('session client message:', message)
  })

  self.client.on('published', (message : any) => {
    self.log.debug('session client published:', message)
  })

  self.session.on('pending', (session : SessionToken) => {
    self.log.debug('session pending:', session)
  })

  self.session.on('cleared', () => {
    self.log.debug('session cleared')
  })

  self.session.on('updated', (session : SessionToken) => {
    self.log.debug('session updated:', session)
  })
}
