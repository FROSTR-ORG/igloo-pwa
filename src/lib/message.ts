import { Buff }    from '@cmdcode/buff'
import * as Schema from '@/schema.js'

import type {
  EventMessage,
  MessageEnvelope,
  RequestMessage,
  ResponseMessage,
  SubscriptionFilter
} from '@/types/index.js'

export function generate_id () {
  return Buff.random(16).hex
}

export function has_message_topic (
  message : MessageEnvelope
) : message is EventMessage | RequestMessage {
  return message.type === 'event' || message.type === 'request'
}

export function is_response_message (
  message : MessageEnvelope
) : message is ResponseMessage {
  return message.type === 'accept' || message.type === 'reject'
}

export function filter_message (
  filter  : SubscriptionFilter,
  message : MessageEnvelope
) : boolean {
  // If the filter has an id and it does not match the message id.
  if (filter.id    && filter.id    !== message.id)    return false
  // If the filter has a type and it does not match the message type.
  if (filter.type  && filter.type  !== message.type)  return false
  // If the filter has a topic,
  if (filter.topic) {
    // If the message does not have a topic, return false.
    if (!has_message_topic(message))    return false
    // If the message topic does not match the filter topic, return false.
    if (message.topic !== filter.topic) return false
  }
  // If the message passes all the filters, return true.
  return true
}

export function parse_message (
  message: unknown
) : MessageEnvelope | null {
  try {
    return Schema.message_envelope.parse(message) as MessageEnvelope
  } catch (error) {
    console.error('[ message ] failed to parse message', error)
    return null
  }
}
