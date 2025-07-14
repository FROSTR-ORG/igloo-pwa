import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST           from '@/const.js'
import { get_store_topics } from '@/lib/message.js'

import type { AppCache } from '@/types/index.js'

const STORE_KEY   = CONST.SYMBOLS.STORE.CACHE
const STORE_TOPIC = get_store_topics(STORE_KEY)
const DEFAULTS    = CONST.APP_CACHE

export function useCache() {
  // Define the message bus.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = DEFAULTS,
    isLoading,
    error
  } = useMessageQuery<AppCache>(STORE_KEY, STORE_TOPIC.FETCH, STORE_TOPIC.EVENT)
  // Define the reset method.
  const reset = () => {
    return bus.request({ domain: STORE_KEY, topic: STORE_TOPIC.RESET })
  }
  // Define the update method.
  const update = (data: Partial<AppCache>) => {
    return bus.request({ domain: STORE_KEY, topic: STORE_TOPIC.UPDATE, params: data })
  }
  // Return the data API and action methods.
  return { data, isLoading, error, reset, update }
}
