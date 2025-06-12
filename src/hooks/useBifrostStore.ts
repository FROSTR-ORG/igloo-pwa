import { useEffect, useState } from 'react'
import { useMessageBus }       from '@/hooks/useMessageBus.js'

import type { BifrostStore } from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json' }

const ACTIONS = SYMBOLS.STORE.BIFROST

const DEFAULT_STORE : BifrostStore = {
  group  : null,
  peers  : [],
  relays : [],
  share  : null
}

export function useBifrostStore () {
  const { request, subscribe } = useMessageBus()
  const [ data, setStore ]     = useState<BifrostStore>(DEFAULT_STORE)

  const reset = () => {
    request({ topic : ACTIONS.RESET })
  }

  const update = (data : Partial<BifrostStore>) => {
    request({ topic : ACTIONS.UPDATE, params : data })
  }

  useEffect(() => {
    const unsub = subscribe<BifrostStore> (ACTIONS.EVENT, (message) => {
      setStore(message.payload)
    })

    return () => unsub()
  }, [ subscribe ])

  return { data, reset, update }
}
