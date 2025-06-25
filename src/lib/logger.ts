import * as CONST           from '@/const.js'
import { BifrostNode }      from '@frostr/bifrost'
import { SessionToken }     from '@cmdcode/nostr-connect'
import { LogController }    from '@/services/logger.js'
import { sanitize_payload } from '@/lib/message.js'

import type {
  NostrClient,
  SessionManager,
  SignedEvent
} from '@cmdcode/nostr-connect'

import type { LogType } from '@/types/index.js'

const DOMAINS = CONST.SYMBOLS.DOMAIN

export function attach_node_logger (
  logger : LogController,
  node   : BifrostNode
) {
  // Listen for node events.
  node.on('*', (event, data) => {
    // Skip message events.
    if (event === 'message') {
      console.log('[ node ] received message', data)
      return
    }
    // Only log ping events to console.
    if (event.startsWith('/ping/req')) {
      console.log('[ node ] received ping', data)
      return
    }

    let type    : LogType = 'info' // Default log type
    let message : string  = String(event).toLowerCase()
    let payload : any     = data

    switch (message) {
      case 'ready':
        console.log('[ node ] node is ready')
        break
      case 'sign':
        console.log('[ node ] node is signing', data)
        break
      case 'req':
        console.log('[ node ] node is requesting', data)
        break
      case 'res':
        console.log('[ node ] node is responding', data)
        break
      case 'error':
        type    = 'error'
        console.log('[ node ] node is erroring', data)
        break
    }

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

    logger.add({
      message : message,
      topic   : DOMAINS.NODE,
      type    : type,
      payload : payload
    })
  })
}

export function attach_rpc_logger (
  logger : LogController,
  client : NostrClient
) {
  client.on('ready', () => {
    logger.add({ message : 'session client ready', topic: DOMAINS.SESSION })
    console.log('[ session ] session client ready')
  })
  client.on('subscribed', () => {
    logger.add({ message : 'session client subscribed', topic : DOMAINS.SESSION })
    console.log('[ session ] session client subscribed')
  })
  client.on('published', (message : any) => {
    console.log('[ session ] session client published:', message)
  })
  client.on('event', (event : SignedEvent) => {
    console.log('[ session ] session client event:', event)
  })
  client.on('message', (message : any) => {
    console.log('[ session ] session client message:', message)
  })
  client.on('published', (message : any) => {
    console.log('[ session ] session client published:', message)
  })
  client.on('error', (err : unknown) => {
    logger.add({
      message : 'session client error',
      topic   : DOMAINS.SESSION,
      type    : 'error',
      payload : err
    })
    console.error('[ session ] session client error:', err)
  })
  client.on('close', () => {
    logger.add({ message : 'session client closed', topic : DOMAINS.SESSION })
    console.log('[ session ] session client closed')
  })
}

export function attach_session_logger (
  logger : LogController,
  client : SessionManager
) {
  client.on('activated', (session : SessionToken) => {
    logger.add({ message : 'session activated', payload : session, topic : DOMAINS.SESSION })
    console.log('[ session ] session activated:', session)
  })
  client.on('cleared', () => {
    logger.add({ message : 'session cleared', topic : DOMAINS.SESSION })
    console.log('[ session ] session cleared')
  })
  client.on('revoked', (session : string) => {
    logger.add({ message : 'session revoked', payload : session, topic : DOMAINS.SESSION })
    console.log('[ session ] session revoked:', session)
  })
  client.on('pending', (session : SessionToken) => {
    logger.add({ message : 'session pending', payload : session, topic : DOMAINS.SESSION })
    console.log('[ session ] session pending:', session)
  })
  client.on('updated', (session : SessionToken) => {
    logger.add({ message : 'session updated', payload : session, topic : DOMAINS.SESSION })
    console.log('[ session ] session updated:', session)
  })
}
