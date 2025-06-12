import { useEffect, useState } from 'react'
import { useMessageBus }       from '@/hooks/useMessageBus.js'

import type { BifrostInfo } from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json' }

export function useBifrostNode () {
  const { request, subscribe } = useMessageBus()
  const [ info, setInfo ]      = useState<BifrostInfo | null>(null)

  const ping = (pubkey : string) => {
    request({ topic : SYMBOLS.CLIENT.BIFROST.PING, params : pubkey })
  }

  const reset = () => {
    request({ topic : SYMBOLS.CLIENT.BIFROST.RESET })
  }

  const unlock = (password : string) => {
    request({ topic : SYMBOLS.CLIENT.BIFROST.UNLOCK, params : password })
  }

  useEffect(() => {
    const unsub = subscribe<BifrostInfo> (SYMBOLS.CLIENT.BIFROST.STATUS, (message) => {
      setInfo(message.payload)
    })

    return () => unsub()
  }, [ subscribe ])

  return { info, ping, reset, unlock }
}
