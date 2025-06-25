import { create_logger } from '@/lib/logger.js'

import {
  filter_message,
  generate_id,
  parse_message
} from '@/lib/message.js'

import type {
  EventTemplate,
  MessageEnvelope,
  MessageFilter,
  EventMessage,
  RejectMessage,
  AcceptMessage,
  GlobalInitScope,
  MessageSubscription
} from '@/types/index.js'

export class MessageBus {
  private readonly _scope : GlobalInitScope
  private readonly _subs  : Set<MessageSubscription> = new Set()

  constructor (scope : GlobalInitScope) {
    this._scope = scope
  }

  get log () {    
    return create_logger('mbus')
  }

  handle (event : ExtendableMessageEvent) {
    // Parse the message.
    const message = parse_message(event.data)
    // If the message is not valid, return.
    if (!message) return
    // Log the message.
    this.log.info('received message:', message)
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
    this.log.info('sent message:', message)
  }

  reject (id : string, error : string) {
    // Create the message.
    const message = { id, ok : false, error, type : 'reject' }
    // Send the message.
    this._send(message as RejectMessage)
  }

  respond (id : string, result : unknown) {
    // Create the message.
    const message = { id, ok : true, result, type : 'accept' }
    // Send the message.
    this._send(message as AcceptMessage)
  }

  send (template : EventTemplate) {
    // Create the message.
    const message = { ...template, id : generate_id(), type : 'event' }
    // Send the message.
    this._send(message as EventMessage)
  }

  subscribe (callback : (message: MessageEnvelope) => void, filter? : MessageFilter) {
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
