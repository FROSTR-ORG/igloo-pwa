import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type { LogEntry } from '@/types/index.js'

const CONSOLE_DOMAIN = CONST.SYMBOLS.DOMAIN.CONSOLE
const CONSOLE_TOPIC  = CONST.SYMBOLS.TOPIC.CONSOLE

export function useConsole () {
  // Define the message bus and query client.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = [],
    isLoading,
    error
  } = useMessageQuery<LogEntry[]>(CONSOLE_TOPIC.FETCH, CONSOLE_TOPIC.EVENT)
  // Define the clear method.
  const clear = () => { bus.request({ domain: CONSOLE_DOMAIN, topic: CONSOLE_TOPIC.CLEAR }) }
  // Return the data API and action methods.
  return { data, isLoading, error, clear }
}
