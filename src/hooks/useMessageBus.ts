import { useCallback, useEffect, useRef, useState } from 'react'

import { BUS_TIMEOUT } from '@/const.js'
import { Assert }      from '@/util/assert.js'

import {
  generate_id,
  parse_message
} from '@/lib/message.js'

import type {
  RequestMessage,
  ResponseMessage,
  MessageHandler,
  PendingResponse,
  EventMessage
} from '@/types/index.js'

export function useMessageBus() {
  const [ isReady, setIsReady ] = useState(false)

  const subscribeRef = useRef(new Map<string, Set<MessageHandler>>())
  const pendingRef   = useRef(new Map<string, PendingResponse>())

  const handle_response = useCallback((message: ResponseMessage): void => {
    // Unpack the message.
    const { id } = message
    // If the message has no id or is not in the pending map, return.
    if (!id || !pendingRef.current.has(id)) return
    // Unpack the pending response.
    const { resolve, reject, timeoutId } = pendingRef.current.get(id)!
    // Delete the pending response.
    pendingRef.current.delete(id)
    // Clear the timeout.
    clearTimeout(timeoutId)
    // If the message is an error, reject the promise.
    if (message.ok) {
      resolve(message)
    } else {
      reject(message.error || 'unknown error')
    }
  }, [])

  const notify_subscribers = useCallback(<T = unknown> (message: EventMessage<T>) : void => {
    // Get the listeners for the message type.
    const subscribers = subscribeRef.current.get(message.type)
    // If there are no listeners, return.
    if (!subscribers) return
    // Notify the listeners.
    subscribers.forEach(dispatch => dispatch(message))
  }, [])

  const handle_message = useCallback((event: MessageEvent): void => {
    // Unpack the message.
    const message = parse_message(event.data)
    // If the message is invalid,
    if (message && message.type === 'response') {
      // Handle the response.
      handle_response(message)
    } else if (message && message.type === 'event') {
      // Notify the subscribers.
      notify_subscribers(message)
    } else {
      // Log the invalid message and return.
      console.error('[ service/bus ] received invalid message', message)
    }
  }, [ handle_response, notify_subscribers ])

  const connect = useCallback(async (): Promise<void> => {
    // If the service worker controller is available,
    if (navigator.serviceWorker.controller) {
      // Set the ready state to true.
      setIsReady(true)
      // Return a resolved promise.
      return Promise.resolve()
    }
    // If the service worker controller is not available,
    return new Promise((resolve) => {
      // Add a listener for the controllerchange event.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Set the ready state to true.
        setIsReady(true)
        // Resolve the promise.
        resolve()
      })
    })
  }, [])

  const subscribe = useCallback (
    <T = unknown> (
      event    : string,
      callback : MessageHandler<T>
    ) : (() => void) => {
    // If the listener map does not have the event,
    if (!subscribeRef.current.has(event)) {
      // Set the event to a new set.
      subscribeRef.current.set(event, new Set())
    }
    // Add the callback to the listener map.
    subscribeRef.current.get(event)!.add(callback as MessageHandler)
    // Return a function to remove the callback from the listener map.
    return () => {
      // Get the listeners for the event.
      const subscribers = subscribeRef.current.get(event)
      // If the subscribers exist,
      if (subscribers) {
        // Delete the callback.
        subscribers.delete(callback as MessageHandler)
      }
    }
  }, [])

  const request = useCallback(async (
    template : Omit<RequestMessage, 'id' | 'type'>
  ) : Promise<ResponseMessage> => {
    // Connect to the service worker.
    await connect()
    // Get the service worker controller.
    const controller = navigator.serviceWorker.controller
    // If the controller is not available, throw an error.
    Assert.exists(controller, 'No service worker controller available')
    // Generate a new id.
    const id = generate_id()
    // Pack the message with the id.
    const message : RequestMessage = { ...template, id, type: 'request' }
    // Log the message.
    console.log('[ app/bus ] sending message:', JSON.stringify(message, null, 2))
    // Return a promise that resolves with the response message.
    return new Promise<ResponseMessage>((resolve, reject) => {
      // Set a timeout to reject the promise if the response is not received.
      const timeoutId = window.setTimeout(() => {
        // If the pending response exists,
        if (pendingRef.current.has(id)) {
          // Delete the pending response.
          pendingRef.current.delete(id)
          // Reject the promise.
          reject(new Error('Response timeout'))
        }
      }, BUS_TIMEOUT)
      // Set the pending response.
      pendingRef.current.set(id, { resolve: resolve as any, reject, timeoutId })
      // Post the message to the service worker.
      controller.postMessage(message)
    })
  }, [ connect ])

  useEffect(() => {
    // If the navigator is available and the service worker is available,
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      // Add a listener for the message event.
      navigator.serviceWorker.addEventListener('message', handle_message)
      // Return a function to remove the listener.
      return () => {
        // Remove the listener for the message event.
        navigator.serviceWorker.removeEventListener('message', handle_message)
      }
    }
  }, [ handle_message ])

  // Cleanup pending responses on unmount
  useEffect(() => {
    return () => {
      // Clear all pending timeouts
      pendingRef.current.forEach(({ timeoutId }) => {
        clearTimeout(timeoutId)
      })
      // Clear all pending responses.
      pendingRef.current.clear()
      // Clear all subscribers.
      subscribeRef.current.clear()
    }
  }, [])

  return { isReady, connect, subscribe, request }
}
