import * as Schema from '@/schema.js'

import type {
  AppCache,
  AppSettings
} from '@/types/index.js'

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
