import {
  GLOBAL_INIT_STATE,
  GLOBAL_SERVICES
} from '@/const.js'

import type {
  GlobalInitState,
  GlobalReadyState,
  GlobalServicesInit,
} from '@/types/index.js'

export function is_global_ready (
  scope : any
) : scope is GlobalReadyState {
  // For each key in the global state,
  for (const key in GLOBAL_INIT_STATE) {
    // If the key is not initialized,
    if (scope[key] === undefined) {
      // Return false.
      return false
    }
  }
  // For each key in the global services,
  for (const key in GLOBAL_SERVICES) {
    // If the key is not in the proper state,
    if (
      scope.service[key] === undefined ||
      scope.service[key] === null      ||
      typeof scope.service[key] !== 'object'
    ) {
      // Return false.
      return false
    }
  }
  // Return true.
  return true
}

export function assert_global_ready (
  state : unknown
) : asserts state is GlobalReadyState {
  if (!is_global_ready(state)) {
    throw new Error('global state not ready')
  }
}

export function print_global_report (global : any) {
  // Print the global service status.
  print_service_status(global)
  // Print the global state.
  print_global_state(global)
}

export function print_global_state (self : GlobalInitState) {
  console.log('[ global ] current state:')
  // For each key in the global defaults,
  for (const key in GLOBAL_INIT_STATE) {
    // Set the key to the default value.
    console.log(`${key}:`, self[key as keyof GlobalInitState])
  }
}

export function print_service_status (global : any) {
  console.log('[ global ] service status:')
  // For each key in the global flags,
  for (const global_key in GLOBAL_SERVICES) {
    // Define the key as a global service key.
    const key = global_key as keyof GlobalServicesInit
    // Initialize the status as 'INIT'.
    let status = 'INIT'
    // If the key is an object, set the status to 'OK'.
    if (typeof global[key] === 'object') status = 'OK'
    // If the key is null, set the status to 'NULL'.
    if (global[key] === null)            status = 'NULL'
    // Print the key and status.
    console.log(`${key}:`, status)
  }
}

export function print_global_services (global : any) {
  // For each key in the global services,
  for (const key in GLOBAL_SERVICES) {
    // If the key is not in the state,
    console.log(`${key}:`, global[key as keyof GlobalServicesInit])
  }
}
