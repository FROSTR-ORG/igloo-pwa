import { useEffect, useState } from 'react'
import { useMessage }          from '@/hooks/useMessage.js'

import type { LogEntry } from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json' }

export function useLogger () {
  const { request, subscribe } = useMessage()
  const [ entries, setLogs ]   = useState<LogEntry[]>([])

  const clear = () => {
    request({ topic : SYMBOLS.LOG.CLEAR })
  }

  useEffect(() => {
    const unsub = subscribe<LogEntry[]> (SYMBOLS.LOG.EVENT, (message) => {
      setLogs(message.payload)
    })

    return () => unsub()
  }, [ subscribe ])

  return { entries, clear }
}
