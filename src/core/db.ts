import { EventEmitter }        from '@vbyte/micro-lib'
import { Assert }              from '@vbyte/micro-lib/assert'
import { logger }              from '@/logger.js'

import { SYMBOLS, DB_NAME, DB_VERSION } from '@/const.js'

import type { StoreData } from '@/types/index.js'

const LOG    = logger('db')
const STORES = Object.values(SYMBOLS.STORE) as string[]

export class DBController extends EventEmitter<{
  open  : [ db : IDBDatabase ]
  init  : [ storeName : string, data : StoreData ]
  fetch : [ storeName : string, data : StoreData ]
  save  : [ storeName : string, data : StoreData ]
  close : [ db : IDBDatabase ]
  error : [ error : unknown ]
}> {
  private _db : IDBDatabase | null = null

  constructor () {
    super()
    LOG.debug('controller installed')
  }

  get db () : IDBDatabase {
    Assert.exists(this._db, 'database is not open')
    return this._db
  }

  get is_open () : boolean {
    return this._db !== null
  }

  async _load (
    storeName : string,
    mode      : IDBTransactionMode
  ) : Promise<IDBObjectStore> {
    // Open the database.
    await this.open()
    // Create a transaction on the store.
    const tx = this.db.transaction(storeName, mode)
    // Return the object store.
    return tx.objectStore(storeName)
  }

  async open () {
    // If the database is not open,
    if (!this.is_open) {
      // Open the database.
      const db = await open_store(this)
      // Close the database when the version changes.
      db.onversionchange = () => { db.close(); this._db = null }
      // Set the database.
      this._db = db
      // Emit the database opening.
      this.emit('open', db)
      // Log the database opening.
      LOG.info('database opened')
    }
  }

  async init (storeName : string, defaults : StoreData) : Promise<StoreData> {
    // Load the current data.
    const current  = await this.fetch(storeName)
    // Get the missing data.
    const missing  = get_missing_data(current, defaults)
    // Get the orphaned keys.
    const orphaned = get_orphaned_keys(current, defaults)
    // If there is no database, open it.
    await this.open()
    // Initialize the store.
    await initialize_store(this.db, storeName, missing, orphaned)
    // Load the store.
    const store = await this.fetch(storeName)
    // Emit the store initialization.
    this.emit('init', storeName, store)
    // Log the store initialization.
    LOG.info('store initialized:', storeName)
    // Return the store.
    return store
  }

  async fetch (storeName : string) : Promise<StoreData> {
    // Load the store in readonly mode.
    const store = await this._load(storeName, 'readonly')
    // Try to load the data.
    return new Promise<StoreData>((resolve, reject) => {
      // Create a new object to store the data.
      const result: StoreData = {}
      // Create a cursor request to iterate over all entries
      const request = store.openCursor()
      // If the request fails, reject the promise.
      request.onerror = () => {
        // Log the error.
        LOG.error('failed to fetch store:', storeName)
        // Reject the promise.
        reject(request.error)
      }
      // If the request succeeds, resolve the promise.
      request.onsuccess = (event) => {
        // Get the cursor from the event.
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
        // If the cursor is not null,
        if (cursor) {
          // Store the key-value pair.
          result[cursor.key.toString()] = cursor.value
          // Move to the next entry.
          cursor.continue()
        } else {
          // Emit the store fetch.
          this.emit('fetch', storeName, result)
          // Log the store fetch.
          LOG.info('store fetched:', storeName)
          // Resolve with the result.
          resolve(result)
        }
      }
    })
  }

  async save (storeName : string, data : StoreData) : Promise<void> {
    // Load the store in readwrite mode.
    const store = await this._load(storeName, 'readwrite')
    // Store each property separately.
    const promises = Object.entries(data).map(async ([ key, value ]) => {
      // Create a promise to save the data.
      return new Promise<void>((resolve, reject) => {
        // Create a request to save the data.
        const request = store.put(value, key)
        // If the request fails, reject the promise.
        request.onerror = () => reject(request.error)
        // If the request succeeds, resolve the promise.
        request.onsuccess = () => {
          // Emit the store save.
          this.emit('save', storeName, data)
          // Log the store save.
          LOG.info('store saved:', storeName)
          // Resolve the promise.
          resolve()
        }
      })
    })
    // Execute the promises.
    await Promise.all(promises)
  }
}

function open_store (self: DBController): Promise<IDBDatabase> {
  // Return a promise that opens the database.
  return new Promise((resolve, reject) => {
    // Create the open request.
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    // If the database is not open, reject the promise.
    request.onerror   = () => reject(request.error)
    // Handle database schema creation/upgrade
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      LOG.info('upgrading database to version', DB_VERSION)
      LOG.info(' existing stores:', Array.from(db.objectStoreNames))
      // For each store name in the stores array,
      for (const store of STORES) {
        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(store)) {
          LOG.info('creating object store:', store)
          db.createObjectStore(store)
        } else {
          LOG.info('object store already exists:', store)
        }
      }
      LOG.info('final stores:', Array.from(db.objectStoreNames))
    }
    // If the database is opened, resolve the promise.
    request.onsuccess = () => {
      // Unpack the database from the result.
      resolve(request.result)
    }
  })
}

function initialize_store (
  db        : IDBDatabase,
  storeName : string,
  missing   : StoreData,
  orphaned  : string[]
) : Promise<void> {
  return new Promise<void>(async(resolve, reject) => {
    // Create a transaction on the store.
    const tx    = db.transaction(storeName, 'readwrite')
    // Get the store controller from the transaction.
    const store = tx.objectStore(storeName)
    // Initialize a promise array.
    const promises: Promise<void>[] = []
    // For each missing entry,
    for (const [ key, value ] of Object.entries(missing)) {
      // Wrap our operation in a promise.
      promises.push(new Promise<void>((resolve, reject) => {
        // Create a request to save the data.
        const request = store.put(value, key)
        // If the request fails, reject the promise.
        request.onerror   = () => reject(request.error)
        // If the request succeeds, resolve the promise.
        request.onsuccess = () => resolve()
      }))
    }
    // For each orphaned key,
    for (const key of orphaned) {
      // Wrap our operation in a promise.
      promises.push(new Promise<void>((resolve, reject) => {
        // Create a request to delete the data.
        const request = store.delete(key)
        // If the request fails, reject the promise.
        request.onerror   = () => reject(request.error)
        // If the request succeeds, resolve the promise.
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
