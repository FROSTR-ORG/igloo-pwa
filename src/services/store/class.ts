import { EventEmitter }         from '@vbyte/micro-lib'
import { Assert }               from '@vbyte/micro-lib/assert'
import { GlobalController }     from '@/core/global.js'
import { get_store_topics }     from '@/lib/message.js'
import { logger }               from '@/logger.js'
import { handle_store_message } from './handler.js'

import type {
  StoreData,
  StoreMiddleware,
  GlobalInitScope,
  StoreConfig,
  StoreTopics,
  MessageEnvelope
} from '@/types/index.js'

export class StoreController <T extends StoreData> extends EventEmitter<{
  update : [ current : T, updated : T ]
  ready  : [ data : T ]
  reset  : [ data : T ]
}> {
  private readonly _global     : GlobalController
  private readonly _defaults   : T
  private readonly _store_key  : string
  private readonly _topics     : StoreTopics
  private readonly _validator  : (data : unknown) => asserts data is T

  private _middleware : Set<StoreMiddleware<T>> = new Set()
  private _store      : T | null                = null

  constructor (
    scope  : GlobalInitScope,
    config : StoreConfig<T>
  ) {
    super()
    this._global    = GlobalController.fetch(scope)
    this._store_key = config.store_key
    this._topics    = get_store_topics(this._store_key)
    this._defaults  = config.defaults
    this._validator = config.validator ?? (() => {})
    this.log.debug('controller installed')
  }

  get data () : T {
    return this._store ?? this._defaults
  }

  get global () {
    return this._global
  }

  get is_ready () : boolean {
    return this._store !== null
  }

  get log () {
    return logger(this._store_key)
  }

  get store_key () {
    return this._store_key
  }

  get topics () {
    return this._topics
  }

  _dispatch (payload : T = this.data) {
    // Send the update event to the message bus.
    this.global.mbus.publish({
      domain  : this._store_key,
      topic   : this.topics.EVENT,
      payload
    })
  }

  async _handler (msg : MessageEnvelope) {
    handle_store_message(this, msg)
  }

  init () {
    // Attach a listener to the database init event.
    this.global.db.on('init', (store_key, store_data) => {
      // If the store key does not match, return.
      if (store_key !== this._store_key) return
      // Initialize the store with the data.
      this._store = store_data as T
      // Subscribe to the message bus for updates.
      this.global.mbus.subscribe(this._handler.bind(this), { domain : this._store_key })
      // Emit the ready event.
      this.emit('ready', this.data)
      // Log the store initialization.
      this.log.info('store activated')
    })
    // Initialize the store.
    this.global.db.init(this._store_key, this._defaults)
  }

  async fetch () : Promise<T> {
    Assert.ok(this.is_ready, 'store not initialized')
    // Load the store.
    this._store = await this.global.db.fetch(this._store_key) as T
    // Return the store.
    return this._store
  }

  on_change (middleware : StoreMiddleware<T>) : () => void {
    // Add the middleware to the set.
    this._middleware.add(middleware)
    // Return a function to remove the middleware from the set.
    return () => this._middleware.delete(middleware)
  }

  async update (changes : Partial<T>) {
    Assert.ok(this.is_ready, 'store not initialized')
    // Load the current store.
    const current = await this.global.db.fetch(this._store_key)
    // Assert the store is of the correct type.
    this._validator(current)
    // Define the current and updated store.
    let   updated = { ...current, ...changes }
    // For each middleware method,
    for (const fn of this._middleware) {
      // Run the middleware.
      updated = await fn(current, updated)
    }
    // Validate the updated store.
    this._validator(updated)
    // Return a promise that resolves when the store is saved.
    await this.global.db.save(this._store_key, updated)
    // Update the store.
    this._store = updated
    // Send the updated store to subscribers.
    this._dispatch(updated)
  }

  reset () {
    Assert.ok(this.is_ready, 'store not initialized')
    // Return a promise that resolves when the store is reset.
    return this.global.db.save(this._store_key, this._defaults)
  }
}
