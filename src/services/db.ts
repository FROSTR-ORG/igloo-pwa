import { DB_NAME, DB_VERSION } from '@/const.js'

type StoreCallback = (data: any) => void

let db : IDBDatabase | null = null

const SUB_MAP = new Map<string, Set<StoreCallback>>()

export namespace DBController {
  export const open = openDB
  export const save = saveDB
  export const load = loadDB
  export const sub  = subToDB
}

/**
 * Opens a connection to the IndexedDB database
 * Creates the specified store if it doesn't exist
 * @param storeName - Name of the store to ensure exists
 * @returns Promise resolving to the database connection
 */
async function openDB (storeName: string): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror   = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      // Create the requested store if it doesn't exist
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName)
      }
    }
  })
}

/**
 * Saves data to a specified store
 * @param storeName - Name of the store to save to
 * @param data - Data to save (will be stored with key 'current')
 * @returns Promise that resolves when save is complete
 */
async function saveDB (storeName: string, data: any): Promise<void> {
  const db = await openDB(storeName)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store       = transaction.objectStore(storeName)
    const request     = store.put(data, 'current')

    request.onerror   = () => reject(request.error)
    request.onsuccess = () => {
      notify(storeName, data)
      resolve()
    }
  })
}

/**
 * Loads data from a specified store
 * @param storeName - Name of the store to load from
 * @returns Promise resolving to the stored data or null if not found
 */
async function loadDB<T>(storeName: string): Promise<T | null> {
  const db = await openDB(storeName)
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store       = transaction.objectStore(storeName)
    const request     = store.get('current')

    request.onerror   = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || null)
  })
}

/**
 * Subscribe to changes in a specific store
 * @param storeName - Name of the store to subscribe to
 * @param callback - Function to call when store data changes
 * @returns Function to unsubscribe from store changes
 */
function subToDB(storeName: string, callback: StoreCallback): () => void {
  if (!SUB_MAP.has(storeName)) {
    SUB_MAP.set(storeName, new Set())
  }
  SUB_MAP.get(storeName)!.add(callback)
  
  // Return unsubscribe function
  return () => {
    const subs = SUB_MAP.get(storeName)
    if (subs) {
      subs.delete(callback)
      if (subs.size === 0) {
        SUB_MAP.delete(storeName)
      }
    }
  }
}

/**
 * Notify all subscribers of a store change
 * @param storeName - Name of the store that changed
 * @param data - New data in the store
 */
function notify (storeName: string, data: any): void {
  const subs = SUB_MAP.get(storeName)
  if (subs) {
    subs.forEach(callback => callback(data))
  }
}