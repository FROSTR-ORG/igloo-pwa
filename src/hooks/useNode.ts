import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type { NodeState } from '@/types/index.js'

const TOPIC   = CONST.SYMBOLS.TOPIC.NODE

const DEFAULTS = {
  peers  : [],
  pubkey : null,
  status : 'loading'
}

export function useBifrostNode() {
  // Define the message bus and query client.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = DEFAULTS,
    isLoading,
    error
  } = useMessageQuery<NodeState>(TOPIC.FETCH, TOPIC.EVENT)
  // Define the ping method.
  const ping = (pubkey : string) => {
    return bus.request({ topic: TOPIC.PING, params: pubkey })
  }
  // Define the reset method.
  const reset = () => {
    return bus.request({ topic: TOPIC.RESET })
  }
  // Return the data API and action methods.
  return { data, isLoading, error, ping, reset }
}
