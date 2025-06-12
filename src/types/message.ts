export type MessageType = 'request' | 'response' | 'event'

export type MessageEnvelope = RequestMessage | ResponseMessage | EventMessage
export type MessageHandler<T = unknown>  = (message: EventMessage<T>) => void | Promise<void>
export type ResponseMessage<T = unknown> = AcceptMessage<T> | RejectMessage

export type RequestTemplate  = Omit<RequestMessage, 'id' | 'type'>
export type ResponseTemplate = Omit<ResponseMessage, 'type'>
export type EventTemplate    = Omit<EventMessage, 'id' | 'type'>

export interface SubscriptionFilter {
  id?    : string
  topic? : string
  type?  : MessageType
}

export interface PendingResponse<T = unknown> {
  resolve   : (value   : ResponseMessage<T>) => void 
  reject    : (reason? : string) => void
  timeoutId : number
}

export interface BaseMessage {
  id : string
}

export interface RequestMessage extends BaseMessage {
  params? : unknown
  topic   : string
  type    : 'request'
}

export interface AcceptMessage<T = unknown> extends BaseMessage {
  ok     : true
  result : T
  type   : 'response'
}

export interface RejectMessage extends BaseMessage {
  ok    : false
  error : string
  type  : 'response'
}

export interface EventMessage<T = unknown> extends BaseMessage {
  payload : T
  topic   : string
  type    : 'event'
}
 