import { GlobalController } from '@/core/global.js'
import { logger }           from '@/logger.js'
import { now }              from '@vbyte/micro-lib/util'

import {
  SYMBOLS,
  DISPATCH_TIMEOUT
} from '@/const.js'

import type {
  GlobalInitScope,
  LogEntry,
  LogFilter,
  LogTemplate,
  RequestMessage
} from '@/types/index.js'

const LOG    = logger('console')
const DOMAIN = SYMBOLS.DOMAIN.CONSOLE
const TOPIC  = SYMBOLS.TOPIC.CONSOLE

const LOG_LIMIT = 100

export class ConsoleController {
  private readonly _global : GlobalController

  private _logs  : LogEntry[] = []
  private _timer : NodeJS.Timeout | null = null

  constructor (scope : GlobalInitScope) {
    this._global = GlobalController.fetch(scope)
    LOG.debug('controller installed')
  }

  get global () {
    return this._global
  }

  _dispatch () {
    // If the timer is not null, clear it.
    if (this._timer) clearTimeout(this._timer)
    // Set the timer to dispatch the payload.
    this._timer = setTimeout(() => {
      // Send a node status event.
      this.global.mbus.publish({
        domain  : DOMAIN,
        topic   : TOPIC.EVENT,
        payload : this._logs
      })
    }, DISPATCH_TIMEOUT)
  }

  _handler (message : RequestMessage) {
    if (message.domain !== DOMAIN) return
    switch (message.topic) {
      case TOPIC.FETCH:
        const filter = message.params as LogFilter
        const logs   = this.fetch(filter)
        this.global.mbus.accept(message.id, logs)
        break
      case TOPIC.CLEAR:
        this.clear()
        this.global.mbus.accept(message.id, true)
        break
    }
  }

  init () {
    // Subscribe to the message bus.
    this.global.mbus.subscribe(this._handler.bind(this))
    // Log the activation.
    LOG.info('service activated')
  }

  fetch (filter? : LogFilter) : LogEntry[] {
    const logs = (filter)
      ? this._logs.filter(entry => filter_log(filter, entry))
      : this._logs
    return (filter?.limit)
      ? logs.slice(logs.length - filter.limit)
      : logs
  }

  add (template : LogTemplate) {
    const entry = { ...template, stamp : now() }
    entry.type ??= 'info'
    if (this._logs.length > LOG_LIMIT) {
      this._logs = this._logs.slice(this._logs.length - LOG_LIMIT)
    }
    this._logs.push(entry as LogEntry)
    this._dispatch()
  }

  clear () {
    this._logs = []
    this._dispatch()
    LOG.info('cleared logs')
  }
}

function filter_log (
  filter : LogFilter,
  entry  : LogEntry
) {
  if (filter.domain && entry.domain !== filter.domain) return false
  if (filter.type   && entry.type   !== filter.type)   return false
  return true
}
