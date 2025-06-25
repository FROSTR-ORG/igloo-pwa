import type { CoreController }  from '@/core/ctrl.js'
import type { ConsoleController }     from '@/services/console.js'
import type { BifrostController } from '@/services/node/class.js'
import type { RpcController }     from '@/services/rpc/class.js'
import type { StoreController }   from '@/services/store/class.js'

import type {
  AppCache,
  AppSettings,
  PrivateCache
} from '@/types/index.js'

export type GlobalInitScope    = ServiceWorkerGlobalScope & GlobalInitState
export type GlobalReadyScope   = ServiceWorkerGlobalScope & GlobalReadyState
export type GlobalStateKey     = keyof GlobalInitState

export type GlobalInitState    = GlobalServices & GlobalData
export type GlobalReadyState   = GlobalReady & GlobalData

export type CacheController    = StoreController<AppCache>
export type SettingsController = StoreController<AppSettings>

export interface GlobalFlags {
  debug   : boolean
  verbose : boolean
}

export interface GlobalData {
  flags   : GlobalFlags,
  private : PrivateCache
}

export interface GlobalServices {
  cache    : CacheController    | null
  core     : CoreController   | null
  log      : ConsoleController      | null
  node     : BifrostController  | null
  rpc      : RpcController  | null
  settings : SettingsController | null
}

export interface GlobalReady {
  cache    : CacheController
  ctrl     : CoreController
  log      : ConsoleController
  node     : BifrostController
  rpc      : RpcController
  settings : SettingsController
}
