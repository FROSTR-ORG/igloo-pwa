import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type {
  InviteToken,
  SignerSession
} from '@cmdcode/nostr-connect'

import type { SessionState } from '@/types/index.js'

// Define the default cachestate.
const DEFAULTS : SessionState = {
  active  : [],
  pending : []
}

// Define the message topics to use.
const TOPICS = CONST.SYMBOLS.TOPIC.SESSION

export function useSession() {
  // Define the message bus.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = DEFAULTS,
    isLoading,
    error
  } = useMessageQuery<SessionState>(TOPICS.FETCH, TOPICS.EVENT)
  // Define the connect method.
  const connect = (token : InviteToken) => {
    bus.request({ topic : TOPICS.CONNECT, params : token })
  }
  // Define the reset method.
  const reset = () => {
    bus.request({ topic : TOPICS.RESET })
  }
  // Define the revoke method.
  const revoke = (pubkey : string) => {
    bus.request({ topic : TOPICS.REVOKE, params : pubkey })
  } 
  // Define the update method.
  const update = (session : SignerSession) => {
    bus.request({ topic : TOPICS.UPDATE, params : session })
  }
  // Return the data API and action methods.
  return { data, isLoading, error, connect, revoke, reset, update }
}
