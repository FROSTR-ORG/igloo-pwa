import { StoreController } from './class'
import * as CONST          from '@/const.js'

import {
  assert_cache_data,
  assert_settings_data
} from './lib.js'

import type { GlobalInitScope } from '@/types/index.js'

const CACHE_KEY    = CONST.SYMBOLS.STORE.CACHE
const SETTINGS_KEY = CONST.SYMBOLS.STORE.SETTINGS

export function create_cache_store (scope : GlobalInitScope) {
  const config = {
    defaults  : CONST.APP_CACHE,
    store_key : CACHE_KEY,
    validator : assert_cache_data
  }
  return new StoreController(scope, config)
}

export function create_settings_store (scope : GlobalInitScope) {
  const config = {
    defaults   : CONST.APP_SETTINGS,
    store_key  : SETTINGS_KEY,
    validator  : assert_settings_data
  }
  return new StoreController(scope, config)
}
