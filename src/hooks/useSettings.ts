import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback }   from 'react'

import { useMessage } from '@/hooks/useMessage.js'
import * as CONST     from '@/const.js'

import type { ClientStore } from '@/types/index.js'

const ACTIONS  = CONST.SYMBOLS.STORE
const DEFAULTS = CONST.DEFAULT_STORE

export function useSettings() {
  // Define the message bus and query client.
  const bus   = useMessage()
  const query = useQueryClient()

  // Define the query method for fetching data.
  const { data = DEFAULTS, isLoading, error } = useQuery({
    queryFn  : async () => {
      // Fetch data from the store.
      const res = await bus.request({ topic: ACTIONS.FETCH })
      // If successful, return the result.
      if (res.ok) return res.result as ClientStore
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
    return bus.subscribe<ClientStore>(ACTIONS.EVENT, handler)
  }, [ bus.subscribe, handler ])

  const reset = () => {
    return bus.request({ topic: ACTIONS.RESET })
  }

  const update = (data: Partial<ClientStore>) => {
    return bus.request({ topic: ACTIONS.UPDATE, params: data })
  }

  return { data, isLoading, error, reset, update }
}
