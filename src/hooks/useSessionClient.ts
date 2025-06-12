import { useEffect, useState } from 'react'
import { useMessageBus }       from '@/hooks/useMessageBus.js'

import type {
  ConnectionToken,
  SessionToken
} from '@cmdcode/nostr-connect'

import type { SessionStore } from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json' }

const DEFAULT_STORE : SessionStore = {
  active  : [],
  pending : [],
  relays  : []
}

export function useSessionClient () {
  const { request, subscribe } = useMessageBus()
  const [ store, setStore ]    = useState<SessionStore>(DEFAULT_STORE)

  const cancel = (pubkey : string) => {
    request({ topic : SYMBOLS.CLIENT.SESSION.CANCEL, params : pubkey })
  }

  const register = (token : ConnectionToken) => {
    request({ topic : SYMBOLS.CLIENT.SESSION.REGISTER, params : token })
  }

  const reset = () => {
    request({ topic : SYMBOLS.CLIENT.SESSION.REVOKE })
  }

  const revoke = (pubkey : string) => {
    request({ topic : SYMBOLS.CLIENT.SESSION.REVOKE, params : pubkey })
  }

  const update = (session : SessionToken) => {
    request({ topic : SYMBOLS.CLIENT.SESSION.UPDATE, params : session })
  }

  useEffect(() => {
    const unsub = subscribe<SessionStore> (SYMBOLS.CLIENT.SESSION.EVENT, (message) => {
      setStore(message.payload)
    })

    return () => unsub()
  }, [ subscribe ])

  return { store, cancel, register, revoke, reset, update }
}
