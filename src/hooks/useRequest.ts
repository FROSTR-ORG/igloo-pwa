import { useMessageBus, useMessageQuery } from '@/hooks/useMessage.js'

import * as CONST from '@/const.js'

import type { PermissionPolicy, PermissionRequest } from '@cmdcode/nostr-connect'
import type { RequestState }      from '@/types/index.js'

// Define the default cachestate.
const DEFAULTS : RequestState = {
  queue : []
}

// Define the message topics to use.
const DOMAIN = CONST.SYMBOLS.DOMAIN.REQUEST
const TOPIC  = CONST.SYMBOLS.TOPIC.REQUEST

export function useRequest() {
  // Define the message bus.
  const bus = useMessageBus()
  // Define the query method for fetching data.
  const {
    data = DEFAULTS,
    isLoading,
    error
  } = useMessageQuery<RequestState>(DOMAIN, TOPIC.FETCH, TOPIC.EVENT)
  // Define the connect method.
  const approve = (
    req      : PermissionRequest,
    changes? : Partial<PermissionPolicy>
  ) => {
    bus.request({ domain: DOMAIN, topic: TOPIC.APPROVE, params: [ req, changes ] })
  }
  // Define the reset method.
  const deny = (
    req      : PermissionRequest,
    reason   : string,
    changes? : Partial<PermissionPolicy>
  ) => {
    bus.request({ domain: DOMAIN, topic: TOPIC.DENY, params: [ req, reason, changes ] })
  }
  // Define the revoke method.
  const clear = () => {
    bus.request({ domain: DOMAIN, topic: TOPIC.CLEAR })
  }
  // Return the data API and action methods.
  return { data, isLoading, error, approve, deny, clear }
}
