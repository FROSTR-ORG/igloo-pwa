import { EventEmitter }      from '@/class/emitter.js'
import { CoreController }    from '@/core/ctrl.js'
import { create_logger }     from '@vbyte/micro-lib/logger'
import { now }               from '@/util/index.js'
import * as CONST            from '@/const.js'

import type {
  GlobalInitScope,
  LogEntry,
  LogFilter,
  LogTemplate,
  MessageEnvelope,
  MessageFilter
} from '@/types/index.js'

const LOG_DOMAIN = CONST.SYMBOLS.DOMAIN.LOG
const LOG_TOPIC  = CONST.SYMBOLS.TOPIC.LOG
const LOG_LIMIT  = 100

export class LogController extends EventEmitter {
  private readonly _global : CoreController

  private _logs : LogEntry[] = []

  constructor (scope : GlobalInitScope) {
    super()
    this._global = CoreController.fetch(scope)
  }

  get global () {
    return this._global
  }

  get log () {
    return create_logger('logger')
  }

  _dispatch () {
    // Dispatch the logs to the message bus.
    this.global.mbus.send({ topic : LOG_TOPIC.EVENT, payload : this._logs })
  }

  _handler (message : MessageEnvelope) {
    if (message.type !== 'request') return
    switch (message.topic) {
      case LOG_TOPIC.FETCH:
        const filter = message.params as LogFilter
        const logs   = this.fetch(filter)
        this.global.mbus.respond(message.id, logs)
        break
      case LOG_TOPIC.CLEAR:
        this.clear()
        this.global.mbus.respond(message.id, true)
        break
    }
  }

  _subscribe () {
    const filter : MessageFilter = { domain : LOG_DOMAIN }
    this.global.mbus.subscribe(this._handler.bind(this), filter)
    this.log.info('subscribed')
  }

  init () {
    this._subscribe()
    this.log.info('initialized')
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
    this.log.info('cleared logs')
  }
}

function filter_log (
  filter : LogFilter,
  entry  : LogEntry
) {
  if (filter.topic && entry.topic !== filter.topic) return false
  if (filter.type  && entry.type  !== filter.type)   return false
  return true
}
