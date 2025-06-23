import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient }                 from '@tanstack/react-query'

import { BUS_TIMEOUT } from '@/const.js'
import { Assert }      from '@/util/assert.js'

import {
  generate_id,
  is_response_message,
  parse_message
} from '@/lib/message.js'

import type {
  RequestMessage,
  ResponseMessage,
  MessageHandler,
  PendingResponse,
  EventMessage
} from '@/types/index.js'

const SW = navigator.serviceWorker

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
    const { resolve, timeoutId } = pendingRef.current.get(id)!
    // Delete the pending response.
    pendingRef.current.delete(id)
    // Clear the timeout.
    clearTimeout(timeoutId)
    // Log the message.
    console.log('[ useMessage ] received response:', message)
    // Resolve the message.
    resolve(message)
  }, [])

  const notify_subscribers = useCallback(<T = unknown> (message: EventMessage<T>) : void => {
    // Get the listeners for the message topic (not type!).
    const subscribers = subscribeRef.current.get(message.topic)
    // If there are no listeners, return.
    if (!subscribers) return
    // Notify the listeners.
    subscribers.forEach(dispatch => dispatch(message))
  }, [])

  const handle_message = useCallback((event: MessageEvent): void => {
    // Unpack the message.
    const message = parse_message(event.data)
    // If the message is invalid,
    if (message && is_response_message(message)) {
      // Handle the response.
      handle_response(message)
    } else if (message && message.type === 'event') {
      // Notify the subscribers.
      notify_subscribers(message)
    } else {
      // Log the invalid message and return.
      console.error('[ useMessage ] received invalid message', message)
    }
  }, [ handle_response, notify_subscribers ])

  const connect = useCallback(async (): Promise<void> => {
    // If the service worker controller is available,
    if (SW.controller) {
      // Set the ready state to true.
      setIsReady(true)
      // Return a resolved promise.
      return Promise.resolve()
    }
    // If the service worker controller is not available,
    return new Promise((resolve) => {
      // Add a listener for the controllerchange event.
      SW.addEventListener('controllerchange', () => {
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
    // If the controller is not available, throw an error.
    Assert.exists(SW.controller, 'No service worker controller available')
    // Generate a new id.
    const id = generate_id()
    // Pack the message with the id.
    const message : RequestMessage = { ...template, id, type: 'request' }
    // Log the message.
    console.log('[ useMessage ] sending request:', message)
    // Return a promise that resolves with the response message.
    return new Promise<ResponseMessage>((resolve, reject) => {
      // Set a timeout to reject the promise if the response is not received.
      const timeoutId = window.setTimeout(() => {
        // If the pending response exists,
        if (pendingRef.current.has(id)) {
          // Delete the pending response.
          pendingRef.current.delete(id)
          // Reject the promise.
          reject(() => {
            console.error('[ useMessage ] response timeout for request:', id)
          })
        }
      }, BUS_TIMEOUT)
      // Set the pending response.
      pendingRef.current.set(id, { resolve: resolve as any, reject, timeoutId })
      // Post the message to the service worker.
      SW.controller!.postMessage(message)
    })
  }, [ connect ])

  useEffect(() => {
    // If the navigator is available and the service worker is available,
    if (typeof navigator !== 'undefined' && SW) {
      // Add a listener for the message event.
      SW.addEventListener('message', handle_message)
      // Return a function to remove the listener.
      return () => {
        // Remove the listener for the message event.
        SW.removeEventListener('message', handle_message)
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

export function useMessageQuery <T = unknown> (
  fetch_key  : string,
  update_key : string
) {
  // Define the message bus and query client.
  const bus          = useMessageBus()
  const query_client = useQueryClient()
  // Define the message handler for updating the cache.
  const handler = useCallback((message: any) => {
    // Update the cache with the payload from the message.
    query_client.setQueryData([ fetch_key ], message.payload)
  }, [ query_client ])

  // On mount, create a subscription service for cache updates.
  useEffect(() => {
    return bus.subscribe<T>(update_key, handler)
  }, [ bus.subscribe, handler ])

  // Define the query method for fetching data.
  return useQuery<T>({
    queryFn  : async () => {
      // Fetch data from the store.
      const res = await bus.request({ topic: fetch_key })
      // If successful, return the result.
      if (res.ok) return res.result as T
      // Else, throw an error.
      throw new Error(res.error || 'failed to fetch store data')
    },
    queryKey  : [ fetch_key ], // Use fetch action as key.
    staleTime : 5 * 60 * 1000, // Fresh for 5 minutes
    retry     : 3,
    refetchOnMount : true
  })
}