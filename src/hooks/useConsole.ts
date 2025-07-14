import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type { LogEntry } from '@/types/index.js'

const DOMAIN = CONST.SYMBOLS.DOMAIN.CONSOLE
const TOPIC  = CONST.SYMBOLS.TOPIC.CONSOLE

export function useConsole () {
  // Define the message bus and query client.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = [],
    isLoading,
    error
  } = useMessageQuery<LogEntry[]>(DOMAIN, TOPIC.FETCH, TOPIC.EVENT)
  // Define the clear method.
  const clear = () => { bus.request({ domain: DOMAIN, topic: TOPIC.CLEAR }) }
  // Return the data API and action methods.
  return { data, isLoading, error, clear }
}
