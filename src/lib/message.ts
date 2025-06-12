import { Buff } from '@cmdcode/buff'

import type { MessageEnvelope, SubscriptionFilter } from '@/types/index.js'

export function generate_id () {
  return Buff.random(16).hex
}

export function filter_message (
  filter  : SubscriptionFilter,
  message : MessageEnvelope
) : boolean {
  // If the filter has an id and it does not match the message id.
  if (filter.id    && filter.id    !== message.id)    return false
  // If the filter has a type and it does not match the message type.
  if (filter.type  && filter.type  !== message.type)  return false
  // If the filter has a topic, and
  if (filter.topic && (
    // If the message type is a response or the message topic does not match the filter topic.
    message.type === 'response' ||
    message.topic !== filter.topic
  )) return false
  // If the message passes all the filters, return true.
  return true
}

export function parse_message (
  message: unknown
) : MessageEnvelope | null {
  try {
    return JSON.parse(message as string)
  } catch (error) {
    console.error('[ message ] failed to parse message', error)
    return null
  }
}
