import type { GlobalController }  from '@/core/global.js'
import type { ConsoleController } from '@/services/console.js'
import type { BifrostController } from '@/services/node/class.js'
import type { SignerController }  from '@/services/signer/class.js'
import type { StoreController }   from '@/services/store/class.js'

import type {
  AppCache,
  AppSettings,
  PrivateCache
} from '@/types/index.js'

export type GlobalInitScope    = ServiceWorkerGlobalScope & GlobalInitState
export type GlobalReadyScope   = ServiceWorkerGlobalScope & GlobalReadyState
export type GlobalStateKey     = keyof GlobalInitState

export type GlobalInitState    = GlobalServicesInit  & GlobalData
export type GlobalReadyState   = GlobalServicesReady & GlobalData

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

export interface GlobalServicesInit {
  cache    : CacheController    | null
  console  : ConsoleController  | null
  global   : GlobalController   | null
  node     : BifrostController  | null
  settings : SettingsController | null
  signer   : SignerController   | null
}

export interface GlobalServicesReady {
  cache    : CacheController
  console  : ConsoleController
  global   : GlobalController
  node     : BifrostController
  settings : SettingsController
  signer   : SignerController
}
