import type { GlobalController }  from '@/core/global.js'
import type { ConsoleController } from '@/services/console.js'
import type { BifrostController } from '@/services/node/class.js'
import type { RequestController } from '@/services/request/class.js'
import type { SessionController } from '@/services/session/class.js'
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

export type CacheController    = StoreController<AppCache>
export type SettingsController = StoreController<AppSettings>

export interface GlobalFlags {
  debug   : boolean
  verbose : boolean
}

export interface GlobalInitState {
  flags   : GlobalFlags,
  global  : GlobalController | null,
  private : PrivateCache,
  service : GlobalServicesInit,
}

export interface GlobalReadyState extends GlobalInitState {
  global  : GlobalController,
  service : GlobalServicesReady,
}

export interface GlobalServicesInit {
  cache    : CacheController    | null
  console  : ConsoleController  | null
  node     : BifrostController  | null
  request  : RequestController  | null
  session  : SessionController  | null
  signer   : SignerController   | null
  settings : SettingsController | null
}

export interface GlobalServicesReady {
  cache    : CacheController
  console  : ConsoleController
  node     : BifrostController
  request  : RequestController
  session  : SessionController
  signer   : SignerController
  settings : SettingsController
}
