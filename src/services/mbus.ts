import { BUS_TIMEOUT } from '@/const.js'
import { parse_error } from '@/util/index.js'

import {
  filter_message,
  generate_id,
  parse_message
} from '@/lib/message'

import type {
  EventTemplate,
  RequestTemplate,
  MessageEnvelope,
  SubscriptionFilter
} from '@/types/index.js'

// Declare the service worker global scope
declare const self: ServiceWorkerGlobalScope

export namespace MessageBus {
  export const send    = send_event_message
  export const request = send_request_message
  export const respond = {
    accept : send_accept_message,
    reject : send_reject_message
  }
  export const subscribe = subscribe_to_filter
}

function send_event_message (template : EventTemplate) {
  // Send the event.
  send_message({ ...template, id : generate_id(), type : 'event' })
}

function send_accept_message <T = unknown> (
  id     : string, 
  result : T
) {
  send_message({ id, ok : true, result, type : 'response' })
}

function send_reject_message (
  id    : string,
  error : string
) {
  send_message({ id, ok : false, error, type : 'response' })
}

async function send_request_message (template: RequestTemplate) {
  // Create the message.
  const msg = { ...template, id : generate_id(), type : 'request' }
  // Return the promise.
  return new Promise(async (resolve, reject) => {
    // Declare the timeout and unsubscribe function.
    let timeout: NodeJS.Timeout, unsub: (() => void) | undefined
    // Cleanup function for timeout and subscription.
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      if (unsub) unsub()
    }
    // Try to set up the resolver, timeout, and subscription.
    try {
      // Set up the resolver that will clean up and resolve
      const resolver = (message: MessageEnvelope) => {
        cleanup()
        resolve(message)
      }
      // Set up timeout that will clean up and reject
      timeout = setTimeout(() => {
        cleanup()
        reject('timeout')
      }, BUS_TIMEOUT)
      // Subscribe to the filter (await to get the actual unsubscribe function)
      unsub = await subscribe_to_filter({ id : msg.id }, resolver)
    } catch (error) {
      // If setup fails, clean up and reject
      cleanup()
      console.error('[ sw/bus ] error with response handler:', error)
      reject(parse_error(error))
    }
  })
}

async function subscribe_to_filter (
  filter   : SubscriptionFilter,
  callback : (message: MessageEnvelope) => void
) {
  const handler = (event: ExtendableMessageEvent) => {
    const message = parse_message(event.data)
    if (message && filter_message(filter, message)) {
      callback(message)
    }
  }
  self.addEventListener('message', handler)
  return () => {
    self.removeEventListener('message', handler)
  }
}

async function send_message (message : MessageEnvelope) {
  // Log the message.
  console.log('[ sw/bus ] sending message:', JSON.stringify(message, null, 2))
  // Get all clients.
  const clients = await self.clients.matchAll()
  // Broadcast the message to all clients.
  for (const client of clients) {
    // Post the message to the client.
    client.postMessage(message)
  }
}