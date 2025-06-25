import { assert_global_ready } from '@/lib/global.js'
import { create_logger }       from '@vbyte/micro-lib/logger'
import { DBController }        from './db.js'
import { MessageBus }          from './mbus.js'

import type { GlobalInitScope } from '@/types/index.js'

export class CoreController {
  static fetch (scope : GlobalInitScope) : CoreController {
    // If the controller is not initialized, throw an error.
    assert_has_controller(scope.core)
    // Return the controller.
    return scope.core as CoreController
  }

  private readonly _db    : DBController
  private readonly _mbus  : MessageBus
  private readonly _scope : GlobalInitScope

  constructor (scope : GlobalInitScope) {
    this._scope = scope
    this._db    = new DBController()
    this._mbus  = new MessageBus(scope)
    this.log.info('controller created')
  }

  get db () {
    return this._db
  }

  get mbus () {
    return this._mbus
  }

  get log () {
    return create_logger('global')
  }

  get scope () {
    assert_global_ready(this._scope)
    return this._scope
  }

}

function assert_has_controller (
  controller : unknown
) : asserts controller is CoreController {
  if (!(controller instanceof CoreController)) {
    throw new Error('controller is not a GlobalController')
  }
}
