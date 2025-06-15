import { ClientState, ClientStore } from '@/types/index.js'

import * as Schema from '@/schema.js'

export function validate_node_state (
  state : unknown
) : state is ClientState {
  const res = Schema.client_state.safeParse(state)
  if (!res.success) {
    console.error(res.error)
    return false
  }
  return true
}

export function validate_store_data (
  store : unknown
) : store is ClientStore {
  const res = Schema.client_store.safeParse(store)
  if (!res.success) {
    console.error(res.error)
    return false
  }
  return true
}

export function validate_store_update (
  store : unknown
) : store is Partial<ClientStore> {
  const res = Schema.client_store.partial().safeParse(store)
  if (!res.success) {
    console.error(res.error)
    return false
  }
  return true
}