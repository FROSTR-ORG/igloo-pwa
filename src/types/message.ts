export type MessageType = 'request' | 'accept' | 'reject' | 'event'

export type MessageEnvelope = RequestMessage | ResponseMessage | EventMessage
export type ResponseMessage<T = unknown> = AcceptMessage<T> | RejectMessage
export type MessageHandler <T = unknown> = (message: EventMessage<T>) => void | Promise<void>

export type RequestTemplate = Omit<RequestMessage, 'id' | 'type'>
export type EventTemplate   = Omit<EventMessage, 'id' | 'type'>

export interface MessageFilter {
  domain? : string
  id?     : string
  topic?  : string
}

export interface MessageSubscription {
  callback : (message: RequestMessage) => void
  filter?  : MessageFilter
}

export interface PendingResponse<T = unknown> {
  resolve   : (value   : ResponseMessage<T>) => void 
  reject    : (reason? : string) => void
  timeoutId : number
}

export interface EventMessage<T = unknown> {
  domain  : string
  id      : string
  payload : T
  topic   : string
  type    : 'event'
}

export interface RequestMessage<T = unknown> {
  domain  : string
  id      : string
  params? : T
  topic   : string
  type    : 'request'
}

export interface AcceptMessage<T = unknown> {
  id     : string
  ok     : true
  result : T
  type   : 'accept'
}

export interface RejectMessage {
  id    : string
  ok    : false
  error : string
  type  : 'reject'
}
