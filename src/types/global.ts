import type { GlobalController }  from '@/core/global.js'
import type { EnclaveController } from '@/services/enclave.js'
import type { LogController }     from '@/services/logger.js'
import type { BifrostController } from '@/services/node.js'
import type { RpcController }     from '@/services/rpc.js'
import type { StoreController }   from '@/services/store.js'

import type {
  ApplicationCache,
  ApplicationSettings
} from '@/types/index.js'

export type GlobalInitScope    = ServiceWorkerGlobalScope & GlobalInitState
export type GlobalReadyScope   = ServiceWorkerGlobalScope & GlobalReadyState
export type GlobalStateKey     = keyof GlobalInitState

export type GlobalInitState    = GlobalServices & GlobalData
export type GlobalReadyState   = GlobalReady & GlobalData

export type CacheController    = StoreController<ApplicationCache>
export type SettingsController = StoreController<ApplicationSettings>

export interface GlobalFlags {
  debug   : boolean
  verbose : boolean
}

export interface GlobalData {
  flags   : GlobalFlags,
  private : string | null
}

export interface GlobalServices {
  cache    : CacheController    | null
  ctrl     : GlobalController   | null
  enclave  : EnclaveController  | null
  log      : LogController      | null
  node     : BifrostController  | null
  rpc      : RpcController      | null
  settings : SettingsController | null
}

export interface GlobalReady {
  cache    : CacheController
  ctrl     : GlobalController
  enclave  : EnclaveController
  log      : LogController
  node     : BifrostController
  rpc      : RpcController
  settings : SettingsController
}
