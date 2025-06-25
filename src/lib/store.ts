import { StoreController } from '@/services/store.js'
import * as Schema         from '@/schema.js'
import * as CONST          from '@/const.js'

import type {
  AppCache,
  AppSettings,
  GlobalInitScope
} from '@/types/index.js'

const CACHE_KEY    = CONST.SYMBOLS.STORE.CACHE
const SETTINGS_KEY = CONST.SYMBOLS.STORE.SETTINGS
const STORE_TOPIC  = CONST.SYMBOLS.TOPIC.STORE

export function get_store_topics (store_key : string) {
  return {
    EVENT  : `${store_key}.${STORE_TOPIC.EVENT}`,
    FETCH  : `${store_key}.${STORE_TOPIC.FETCH}`,
    RESET  : `${store_key}.${STORE_TOPIC.RESET}`,
    UPDATE : `${store_key}.${STORE_TOPIC.UPDATE}`
  }
}

export function init_cache_store (scope : GlobalInitScope) {
  const config = {
    defaults  : CONST.APP_CACHE,
    store_key : CACHE_KEY,
    validator : assert_cache_data
  }
  return new StoreController (scope, config)
}

export function validate_cache_data (
  cache : unknown
) : cache is AppCache {
  const parsed = Schema.app_cache.safeParse(cache)
  if (!parsed.success) {
    console.error('[ store ] invalid cache data:')
    console.error(parsed.error)
    return false
  }
  return true
}

export function assert_cache_data (
  cache : unknown
) : asserts cache is AppCache {
  if (!validate_cache_data(cache)) {
    throw new Error('invalid cache data')
  }
}

export function init_settings_store (scope : GlobalInitScope) {
  const config = {
    defaults   : CONST.APP_SETTINGS,
    store_key  : SETTINGS_KEY,
    validator  : assert_settings_data
  }
  return new StoreController(scope, config)
}


export function validate_settings_data (
  settings : unknown
) : settings is AppSettings {
  const parsed = Schema.app_settings.safeParse(settings)
  if (!parsed.success) {
    console.error('[ store ] invalid settings data:')
    console.error(parsed.error)
    return false
  }
  return true
}

export function assert_settings_data (
  settings : unknown
) : asserts settings is AppSettings {
  if (!validate_settings_data(settings)) {
    throw new Error('invalid settings data')
  }
}
