import { assert_global_ready } from '@/lib/global.js'
import { logger }              from '@/logger.js'
import { DBController }        from './db.js'
import { MessageBus }          from './mbus.js'

import type { GlobalInitScope } from '@/types/index.js'
import { ConsoleController } from '../services/console.js'

const LOG = logger('global')

export class GlobalController {
  static fetch (scope : GlobalInitScope) : GlobalController {
    // If the controller is not initialized, throw an error.
    assert_has_controller(scope.global)
    // Return the controller.
    return scope.global as GlobalController
  }

  private readonly _db    : DBController
  private readonly _mbus  : MessageBus
  private readonly _scope : GlobalInitScope

  constructor (scope : GlobalInitScope) {
    this._db      = new DBController()
    this._mbus    = new MessageBus(scope)
    this._scope   = scope
    LOG.debug('controller installed')
  }

  get cache () {
    return this.scope.cache
  }

  get db () {
    return this._db
  }

  get mbus () {
    return this._mbus
  }

  get private () {
    return this.scope.private
  }

  get scope () {
    assert_global_ready(this._scope)
    return this._scope
  }

  get service () {
    return {
      console : this.scope.console,
      node    : this.scope.node,
      signer  : this.scope.signer,
    }
  }

  get settings () {
    return this.scope.settings
  }

}

function assert_has_controller (
  controller : unknown
) : asserts controller is GlobalController {
  if (!(controller instanceof GlobalController)) {
    throw new Error('controller is not a GlobalController')
  }
}
