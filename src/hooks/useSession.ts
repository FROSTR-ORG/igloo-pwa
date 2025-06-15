import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback }   from 'react'

import { useMessage } from '@/hooks/useMessage.js'
import * as CONST     from '@/const.js'

import type { SessionStore } from '@/types/index.js'

import type {
  ConnectionToken,
  SessionToken
} from '@cmdcode/nostr-connect'

const ACTIONS  = CONST.SYMBOLS.SESSION
const DEFAULTS = CONST.DEFAULT_SESSION

export function useSession() {
  // Define the message bus and query client.
  const bus   = useMessage()
  const query = useQueryClient()

  // Define the query method for fetching data.
  const { data = DEFAULTS, isLoading, error } = useQuery({
    queryFn  : async () => {
      // Fetch data from the store.
      const res = await bus.request({ topic: ACTIONS.FETCH })
      // If successful, return the result.
      if (res.ok) return res.result as SessionStore
      // Else, throw an error.
      throw new Error(res.error || 'Failed to fetch store data')
    },
    queryKey  : [ ACTIONS.FETCH ], // Use fetch action as key.
    staleTime : 5 * 60 * 1000,     // Fresh for 5 minutes
    retry     : 3
  })

  // Define the message handler for updating the cache.
  const handler = useCallback((message: any) => {
    // Update the cache with the payload from the message.
    query.setQueryData([ ACTIONS.FETCH ], message.payload)
  }, [ query ])

  // On mount, create a subscription service for cache updates.
  useEffect(() => {
    return bus.subscribe<SessionStore>(ACTIONS.EVENT, handler)
  }, [ bus.subscribe, handler ])

  const cancel = (pubkey : string) => {
    bus.request({ topic : ACTIONS.CANCEL, params : pubkey })
  }

  const connect = (token : ConnectionToken) => {
    bus.request({ topic : ACTIONS.CONNECT, params : token })
  }

  const reset = () => {
    bus.request({ topic : ACTIONS.RESET })
  }

  const revoke = (pubkey : string) => {
    bus.request({ topic : ACTIONS.REVOKE, params : pubkey })
  }

  const update = (session : SessionToken) => {
    bus.request({ topic : ACTIONS.UPDATE, params : session })
  }

  return { data, isLoading, error, cancel, connect, revoke, reset, update }
}
