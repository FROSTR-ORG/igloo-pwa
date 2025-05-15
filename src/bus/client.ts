import { MESSAGE, BUS_TIMEOUT } from '@/const.js'

// Types for message handling
type MessageHandler = (payload: any) => void
type PendingResponse = {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timeoutId: number
}

// State
const state = {
  id_counter : 0,
  listeners  : new Map<string, Set<MessageHandler>>(),
  pending    : new Map<string, PendingResponse>(),
  ready      : false,

}

export namespace MessageClient {
  export const connect   = wait_for_service
  export const subscribe = subscribe_to_message
  export const send      = send_message
}

// Helper functions
function is_valid_message (data: any): boolean {
  return data && typeof data === 'object' && 'type' in data && 'id' in data
}

// Handle service worker messages
function handle_message (event: MessageEvent): void {
  if (!is_valid_message(event.data)) {
    console.error('[ app/bus ] received invalid message', event.data)
    return
  }

  const message = event.data

  console.log('[ app/bus ] received message:', JSON.stringify(message, null, 2))
  
  handle_response(message)
  notify_subscribers(message)
}

function handle_response (message: any): void {
  const { id } = message
  if (!id || !state.pending.has(id)) return

  const { resolve, reject, timeoutId } = state.pending.get(id)!
  state.pending.delete(id)
  clearTimeout(timeoutId)

  if (message.type === MESSAGE.ERROR) {
    reject(new Error(message.payload?.error || 'Unknown error'))
  } else {
    resolve(message)
  }
}

function notify_subscribers (message: any): void {
  const listeners = state.listeners.get(message.type)
  if (!listeners) return

  const payload = message.payload
  listeners.forEach(listener => listener(payload))
}

// Public API
function wait_for_service (): Promise<void> {
  if (navigator.serviceWorker.controller) {
    state.ready = true
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      state.ready = true
      resolve()
    })
  })
}

function subscribe_to_message (
  type     : string,
  callback : (payload: any) => void
) : () => void {
  if (!state.listeners.has(type)) {
    state.listeners.set(type, new Set())
  }
  state.listeners.get(type)!.add(callback)

  return () => {
    const listeners = state.listeners.get(type)
    if (listeners) {
      listeners.delete(callback)
    }
  }
}

async function send_message (message: Omit<any, 'id'>): Promise<any> {
  await wait_for_service()

  const controller = navigator.serviceWorker.controller

  if (!controller) {
    throw new Error('No service worker controller available')
  }

  const id = `${++state.id_counter}`
  const messageWithId = { ...message, id }

  console.log('[ app/bus ] sending message to service worker:', JSON.stringify(messageWithId, null, 2))

  return new Promise<any>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      if (state.pending.has(id)) {
        state.pending.delete(id)
        reject(new Error('Response timeout'))
      }
    }, BUS_TIMEOUT)

    state.pending.set(id, { resolve, reject, timeoutId })
    controller.postMessage(messageWithId)
  })
}

navigator.serviceWorker.addEventListener('message', handle_message)