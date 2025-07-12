import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type { LogEntry } from '@/types/index.js'

const LOG_TOPIC = CONST.SYMBOLS.TOPIC.LOG

export function useConsole () {
  // Define the message bus and query client.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = [],
    isLoading,
    error
  } = useMessageQuery<LogEntry[]>(LOG_TOPIC.FETCH, LOG_TOPIC.EVENT)
  // Define the clear method.
  const clear = () => { bus.request({ topic : LOG_TOPIC.CLEAR }) }
  // Return the data API and action methods.
  return { data, isLoading, error, clear }
}
