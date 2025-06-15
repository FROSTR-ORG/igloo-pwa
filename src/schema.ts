import { BaseSchema } from '@/util/index.js'

import { Schema as BifrostSchema } from '@frostr/bifrost'
import { Schema as SessionSchema } from '@cmdcode/nostr-connect'

const z = BaseSchema.zod

export const event_message = z.object({
  id      : z.string(),
  payload : z.unknown(),
  topic   : z.string(),
  type    : z.literal('event')
})

export const request_message = z.object({
  id     : z.string(),
  params : z.unknown().optional(),
  topic  : z.string(),
  type   : z.literal('request')
})

export const response_message = z.object({
  id     : z.string(),
  ok     : z.literal(true),
  result : z.any(),
  type   : z.literal('accept')
})

export const reject_message = z.object({
  id    : z.string(),
  ok    : z.literal(false),
  error : z.string(),
  type  : z.literal('reject')
})

export const message_envelope = z.discriminatedUnion('type', [
  event_message,
  request_message,
  response_message,
  reject_message
])

export const peer_data   = BifrostSchema.peer.data
export const peer_status = z.enum([ 'online', 'offline', 'locked' ])

export const peer_config = BifrostSchema.peer.config.extend({
  pubkey : BaseSchema.hex33,
})

export const relay_policy = z.object({
  url   : z.string(),
  read  : z.boolean(),
  write : z.boolean(),
})

const client_session = SessionSchema.client.session

export const client_state = z.object({
  peers    : z.array(peer_data),
  pubkey   : BaseSchema.hex32.nullable(),
  requests : z.array(z.string()),
  status   : peer_status,
})

export const client_store = z.object({
  group    : BifrostSchema.pkg.group.nullable(),
  peers    : z.array(peer_config),
  pubkey   : BaseSchema.hex33.nullable(),
  relays   : z.array(relay_policy),
  sessions : z.array(client_session),
  share    : z.string().nullable(),
})
