import { DB_NAME, DB_VERSION } from '@/const.js'

type StoreCallback = (data: Record<string, any>) => void
type StoreData     = Record<string, any>
type StoreSubMap   = Map<string, Set<StoreCallback>>

const _sub : StoreSubMap = new Map()
let   _db  : IDBDatabase | null = null

export namespace DBController {
  export const init      = init_db
  export const load      = load_db
  export const save      = save_db
  export const subscribe = subscribe_to_store
}

async function init_db (storeName : string, defaults : StoreData) : Promise<void> {
  // Load the current data.
  const current  = await load_db(storeName)
  // Get the missing data.
  const missing  = get_missing_data(current, defaults)
  // Get the orphaned keys.
  const orphaned = get_orphaned_keys(current, defaults)
  // Initialize the store.
  return _init(storeName, missing, orphaned)
}

async function load_db (storeName : string): Promise<StoreData> {
  // Load the store in readonly mode.
  const store = await _load(storeName, 'readonly')
  // Try to load the data.
  return new Promise<StoreData>((resolve, reject) => {
    const result: StoreData = {}
    // Create a cursor request to iterate over all entries
    const request = store.openCursor()
    // If the request fails, reject the promise.
    request.onerror = () => reject(request.error)
    // If the request succeeds, resolve the promise.
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
      if (cursor) {
        // Store the key-value pair.
        result[cursor.key.toString()] = cursor.value
        // Move to the next entry.
        cursor.continue()
      } else {
        // Resolve with the result
        resolve(result)
      }
    }
  })
}

async function save_db (storeName : string, data : StoreData) : Promise<void> {
  // Load the store in readwrite mode.
  const store = await _load(storeName, 'readwrite')
  // Store each property separately.
  const promises = Object.entries(data).map(async ([ key, value ]) => {
    // Create a promise to save the data.
    return new Promise<void>((resolve, reject) => {
      // Create a request to save the data.
      const request = store.put(value, key)
      // If the request fails, reject the promise.
      request.onerror = () => reject(request.error)
      // If the request succeeds, resolve the promise.
      request.onsuccess = () => resolve()
    })
  })
  // Wait for all promises to resolve.
  await Promise.all(promises)
  // Notify the subscribers.
  _notify(storeName, data)
}

function subscribe_to_store (storeName : string, callback: StoreCallback): () => void {
  // If the store does not exist,
  if (!_sub.has(storeName)) {
    // Create a new set of callbacks for the store.
    _sub.set(storeName, new Set())
  }
  // Add the callback to the store.
  _sub.get(storeName)!.add(callback)
  // Return an unsubscribe function.
  return () => {
    // Get the set of callbacks for the store.
    const subs = _sub.get(storeName)
    // If the store exists,
    if (subs) {
      // Remove the callback from the store.
      subs.delete(callback)
      // If the store has no callbacks,
      if (subs.size === 0) {
        // Delete the store.
        _sub.delete(storeName)
      }
    }
  }
}

async function _open (storeName : string): Promise<IDBDatabase> {
  // If the database is already open, return it.
  if (_db) return _db
  // Return a promise that opens the database.
  return new Promise((resolve, reject) => {
    // Create the open request.
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    // If the database is not open, reject the promise.
    request.onerror   = () => reject(request.error)
    // If the database is opened, resolve the promise.
    request.onsuccess = () => {
      // Unpack the database from the result.
      const db = request.result
      // Handle version changes from other tabs/windows.
      db.onversionchange = () => { db.close(); _db = null }
      // Resolve the promise with the database.
      resolve(db)
    }
    // If the database upgrade is requested,
    request.onupgradeneeded = (event) => {
      // Get the database.
      const db = (event.target as IDBOpenDBRequest).result
      // If the store doesn't exist,
      if (!db.objectStoreNames.contains(storeName)) {
        // Create the store.
        db.createObjectStore(storeName)
      }
    }
  })
}

function _init (
  storeName : string,
  missing   : StoreData,
  orphaned  : string[]
) : Promise<void> {
  return new Promise<void>(async(resolve, reject) => {
    // Open the database.
    const db    = await _open(storeName)
    // Create a transaction on the store.
    const tx    = db.transaction(storeName, 'readwrite')
    // Get the store from the transaction.
    const store = tx.objectStore(storeName)
    // Create a list of promises for the missing data.
    const promises: Promise<void>[] = []
    // Handle missing data
    for (const [key, value] of Object.entries(missing)) {
      promises.push(new Promise<void>((resolve, reject) => {
        const request = store.put(value, key)
        request.onerror   = () => reject(request.error)
        request.onsuccess = () => resolve()
      }))
    }

    // Handle orphaned keys
    for (const key of orphaned) {
      promises.push(new Promise<void>((resolve, reject) => {
        const request = store.delete(key)
        request.onerror   = () => reject(request.error)
        request.onsuccess = () => resolve()
      }))
    }

    // Wait for all operations to complete
    Promise.all(promises).then(() => {
      // Wait for the transaction to complete.
      tx.oncomplete = () => resolve()
      // If the transaction fails, reject the promise.
      tx.onerror = () => reject(tx.error)
    }).catch(reject)
  })
}

async function _load (storeName : string, mode : IDBTransactionMode) : Promise<IDBObjectStore> {
  // Open the database.
  const db = await _open(storeName)
  // Create a transaction on the store.
  const tx = db.transaction(storeName, mode)
  // Return the object store.
  return tx.objectStore(storeName)
}

function _notify (storeName : string, data: StoreData): void {
  _sub.get(storeName)?.forEach(callback => callback(data))
}

function get_missing_data (
  current  : StoreData,
  defaults : StoreData
) : StoreData {
  // Create a new object to store the missing data.
  const missing : StoreData = {}
  // Iterate over the defaults.
  for (const [ key, value ] of Object.entries(defaults)) {
    // If the key is not in the current data, add it to the missing data.
    if (current[key] === undefined) missing[key] = value
  }
  // Return the missing data.
  return missing
}

function get_orphaned_keys (
  current  : StoreData,
  defaults : StoreData
) : string[] {
  // Create a new object to store the orphaned data.
  const orphaned : string[] = []
  // Iterate over the current data.
  for (const [ key ] of Object.entries(current)) {
    // If the key is not in the defaults, add it to the orphaned data.
    if (defaults[key] === undefined) orphaned.push(key)
  }
  // Return the orphaned keys.
  return orphaned
}