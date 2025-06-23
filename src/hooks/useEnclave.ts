import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type { ApplicationCache } from '@/types/index.js'

const TOPIC    = CONST.SYMBOLS.TOPIC.ENCLAVE
const DEFAULTS = CONST.APP_CACHE

export function useEnclave() {
  // Define the message bus.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = DEFAULTS,
    isLoading,
    error
  } = useMessageQuery<ApplicationCache>(TOPIC.FETCH, TOPIC.EVENT)
  // Define the reset method.
  const lock = () => {
    return bus.request({ topic: TOPIC.LOCK })
  }
  // Define the update method.
  const unlock = (password : string) => {
    return bus.request({ topic: TOPIC.UNLOCK, params: password })
  }
  // Return the data API and action methods.
  return { data, isLoading, error, lock, unlock }
}
