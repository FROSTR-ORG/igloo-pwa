import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type {
  ConnectionToken,
  SessionToken
} from '@cmdcode/nostr-connect'

import type { SessionState } from '@/types/index.js'

const TOPIC    = CONST.SYMBOLS.TOPIC.SESSION
const DEFAULTS : SessionState = {
  active  : [],
  pending : [],
  status  : 'loading'
}

export function useNostrSession() {
  // Define the message bus.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = DEFAULTS,
    isLoading,
    error
  } = useMessageQuery<SessionState>(TOPIC.FETCH, TOPIC.EVENT)
  // Define the connect method.
  const connect = (token : ConnectionToken) => {
    bus.request({ topic : TOPIC.CONNECT, params : token })
  }
  // Define the reset method.
  const reset = () => {
    bus.request({ topic : TOPIC.RESET })
  }
  // Define the revoke method.
  const revoke = (pubkey : string) => {
    bus.request({ topic : TOPIC.REVOKE, params : pubkey })
  } 
  // Define the update method.
  const update = (session : SessionToken) => {
    bus.request({ topic : TOPIC.UPDATE, params : session })
  }
  // Return the data API and action methods.
  return { data, isLoading, error, connect, revoke, reset, update }
}
