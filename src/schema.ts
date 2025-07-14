import { z }               from 'zod'
import * as base           from '@vbyte/micro-lib/schema'
import { StoreController } from '@/services/store/class.js'

import {
  BifrostNode,
  Schema as BifrostSchema
} from '@frostr/bifrost'

import {
  SignerClient,
  SessionManager
} from '@cmdcode/nostr-connect'
import { ConsoleController } from './services/console'

export const event_message = z.object({
  domain  : z.string(),
  id      : z.string(),
  payload : z.unknown(),
  topic   : z.string(),
  type    : z.literal('event')
})

export const request_message = z.object({
  domain : z.string(),
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
export const node_status = z.enum([ 'online', 'offline', 'locked', 'connecting', 'loading' ])

export const peer_config = BifrostSchema.peer.config.extend({
  pubkey : base.hex32,
})

export const relay_policy = z.object({
  url   : z.string(),
  read  : z.boolean(),
  write : z.boolean(),
})

export const app_cache = z.object({
  sessions : z.array(z.any())
})

export const app_state = z.object({
  peers    : z.array(peer_data),
  pubkey   : base.hex32.nullable(),
  requests : z.array(z.string()),
  status   : node_status,
})

export const app_settings = z.object({
  group    : BifrostSchema.pkg.group.nullable(),
  peers    : z.array(peer_config),
  pubkey   : base.hex32.nullable(),
  relays   : z.array(relay_policy),
  share    : z.string().nullable(),
})

export const global_state = z.object({
  cache    : z.instanceof(StoreController),
  db       : z.instanceof(IDBDatabase),
  console  : z.instanceof(ConsoleController),
  node     : z.instanceof(BifrostNode).nullable(),
  private  : BifrostSchema.pkg.share.nullable(),
  signer   : z.instanceof(SignerClient).nullable(),
  settings : z.instanceof(StoreController),
  state    : app_state,
  subs     : z.map(z.string(), z.array(z.function())),
})
