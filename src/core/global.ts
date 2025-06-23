import { assert_global_ready } from '@/lib/global.js'
import { get_console }  from '@/lib/logger.js'
import { DBController } from './db.js'
import { MessageBus }   from './mbus.js'

import type { GlobalInitScope } from '@/types/index.js'

export class GlobalController {
  static fetch (scope : GlobalInitScope) : GlobalController {
    // If the controller is not initialized, throw an error.
    assert_has_controller(scope.ctrl)
    // Return the controller.
    return scope.ctrl as GlobalController
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
    return get_console('[ global ]')
  }

  get scope () {
    assert_global_ready(this._scope)
    return this._scope
  }

}

function assert_has_controller (
  controller : unknown
) : asserts controller is GlobalController {
  if (!(controller instanceof GlobalController)) {
    throw new Error('controller is not a GlobalController')
  }
}
