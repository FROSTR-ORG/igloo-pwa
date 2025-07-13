import { GlobalController } from '@/core/global.js'
import { logger }           from '@/logger.js'
import { now }              from '@vbyte/micro-lib/util'
import * as CONST           from '@/const.js'

import type {
  GlobalInitScope,
  LogEntry,
  LogFilter,
  LogTemplate,
  MessageEnvelope,
  MessageFilter
} from '@/types/index.js'

const LOG    = logger('console')
const DOMAIN = CONST.SYMBOLS.DOMAIN.CONSOLE
const TOPIC  = CONST.SYMBOLS.TOPIC.CONSOLE

const LOG_LIMIT  = 100

export class ConsoleController {
  private readonly _global : GlobalController

  private _logs : LogEntry[] = []

  constructor (scope : GlobalInitScope) {
    this._global = GlobalController.fetch(scope)
    LOG.debug('controller installed')
  }

  get global () {
    return this._global
  }

  _dispatch () {
    // Dispatch the logs to the message bus.
    this.global.mbus.publish({
      domain  : DOMAIN,
      topic   : TOPIC.EVENT,
      payload : this._logs
    })
  }

  _handler (message : MessageEnvelope) {
    if (message.type !== 'request') return
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
    // Define a filter for the message bus.
    const filter : MessageFilter = { domain : DOMAIN }
    // Subscribe to the message bus.
    this.global.mbus.subscribe(this._handler.bind(this), filter)
    // Log the subscription.
    LOG.info('subscribed')
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
