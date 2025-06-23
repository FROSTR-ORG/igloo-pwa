import { Buff }    from '@cmdcode/buff'
import * as Schema from '@/schema.js'

import type {
  EventMessage,
  MessageEnvelope,
  RequestMessage,
  ResponseMessage,
  MessageFilter
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

export function create_request_message (
  template : Omit<RequestMessage, 'id' | 'type'>
) : RequestMessage {
  // Generate a new id.
  const id = generate_id()
  // Create the request message.
  return { ...template, id, type: 'request' }
}

export function filter_message (
  filter  : MessageFilter,
  message : MessageEnvelope
) : boolean {
  // If the filter has an id and it does not match the message id.
  if (filter.id    && filter.id    !== message.id)    return false
  // If the filter has a type and it does not match the message type.
  if (filter.type  && filter.type  !== message.type)  return false
  // If the filter has a topic,
  if (filter.topic || filter.domain) {
    // If the message does not have a topic, return false.
    if (!has_message_topic(message))    return false
    // If the message topic does not match the filter topic, return false.
    if (filter.topic  && message.topic !== filter.topic) return false
    // If the message domain does not match the filter domain, return false.
    if (filter.domain && !message.topic.startsWith(filter.domain)) return false
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

export function sanitize_payload (data: unknown) : unknown {
  if (data === null || data === undefined) {
    return data
  }
  
  // Handle primitive types
  if (typeof data !== 'object') {
    return data
  }
  
  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitize_payload(item))
  }
  
  // Handle objects
  try {
    const sanitized: any = {}
    for (const [key, value] of Object.entries(data)) {
      // Skip functions and other non-serializable types
      if (typeof value === 'function') {
        sanitized[key] = '[Function]'
      } else if (typeof value === 'symbol') {
        sanitized[key] = '[Symbol]'
      } else if (typeof value === 'undefined') {
        sanitized[key] = '[Undefined]'
      } else if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects, but avoid circular references
        try {
          sanitized[key] = sanitize_payload(value)
        } catch (err) {
          sanitized[key] = '[Circular Reference]'
        }
      } else {
        sanitized[key] = value
      }
    }
    return sanitized
  } catch (err) {
    // If sanitization fails, return a safe representation
    return String(data)
  }
}