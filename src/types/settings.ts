// TODO: PWA storage update
// import { create_store } from './store.js'

interface Store {
  general : {
    notifications : boolean
  }
  links : {
    is_active       : boolean
    resolver_url    : string
  }
  node : {
    rate_limit : number
  }
}

const DEFAULT_STORE : Store = {
  general : {
    notifications : false,
  },
  links : {
    is_active       : false,
    resolver_url    : 'https://njump.me/{raw}',
  },
  node : {
    rate_limit : 200,
  }
}

// const API = create_store<Store>('settings', DEFAULT_STORE)

export namespace SettingStore {
    export type  Type    = Store
    export const DEFAULT = DEFAULT_STORE
    // export const { fetch, reset, update, subscribe, use } = API
  }