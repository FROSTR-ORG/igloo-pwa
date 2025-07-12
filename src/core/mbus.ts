import { logger }       from '@/logger.js'
import { EventEmitter } from '@vbyte/micro-lib'
import { parse_error }  from '@vbyte/micro-lib/util'

import {
  filter_message,
  generate_id,
  parse_message
} from '@/lib/message.js'

import type {
  EventTemplate,
  MessageEnvelope,
  EventMessage,
  RejectMessage,
  AcceptMessage,
  GlobalInitScope,
  MessageFilter,
  MessageSubscription,
  RequestMessage
} from '@/types/index.js'

const LOG = logger('mbus')

export class MessageBus {
  private readonly _scope : GlobalInitScope

  private _subs : Set<MessageSubscription> = new Set()

  constructor (scope : GlobalInitScope) {
    this._scope = scope
    LOG.debug('controller installed')
  }

  handler (event : ExtendableMessageEvent) {
    // Parse the message.
    const message = parse_message(event.data)
    // If the message is not valid or not a request, return.
    if (!message || message.type !== 'request') return
    // Log the message.
    LOG.debug('received request:', message)
    // For each subscription,
    for (const sub of this._subs) {
      // If the message does not match the filter, skip.
      if (sub.filter && !filter_message(sub.filter, message)) continue
      // Call the callback.
      sub.callback(message)
    }
  }

  async _send (message : MessageEnvelope) {
    // Craft the message event.
    const event = new MessageEvent('message', { data: message })
    // Dispatch the message internally to service worker subscriptions.
    this._scope.dispatchEvent(event)
    // Collect all clients.
    const clients = await this._scope.clients.matchAll()
    // For each client, post the message.
    for (const client of clients) {
      client.postMessage(message)
    }
    // Log the message.
    LOG.debug('sent message:', message)
  }

  accept (id : string, result : unknown) {
    // Create the message.
    const message = { id, ok : true, result, type : 'accept' }
    // Send the message.
    this._send(message as AcceptMessage)
    // Log the message.
    LOG.debug('sent response:', message)
  }

  reject (id : string, error : unknown) {
    // Parse the error.
    const reason = parse_error(error)
    // Create the message.
    const message = { id, ok : false, error : reason, type : 'reject' }
    // Send the message.
    this._send(message as RejectMessage)
    // Log the message.
    LOG.debug('sent rejection:', message)
  }

  publish (template : EventTemplate) {
    // Create the message.
    const message = { ...template, id : generate_id(), type : 'event' }
    // Send the message.
    this._send(message as EventMessage)
    // Log the message.
    LOG.debug('sent event:', message)
  }

  subscribe (
    callback : (message: RequestMessage) => void,
    filter?  : MessageFilter
  ) {
    // Create the subscription.
    const sub : MessageSubscription = { callback, filter }
    // Add the subscription.
    this._subs.add(sub)
    // Return the unsubscribe function.
    return () => {
      this._subs.delete(sub)
    }
  }
}
