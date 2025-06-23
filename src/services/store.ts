import { EventEmitter }        from '@/class/emitter.js'
import { GlobalController }    from '@/core/global.js'
import { Assert, parse_error } from '@/util/index.js'

import type {
  StoreData,
  RequestMessage,
  StoreMiddleware,
  GlobalInitScope,
  StoreConfig,
  StoreTopics,
  MessageEnvelope
} from '@/types/index.js'
import { get_console } from '@/lib/logger'

export class StoreController <T extends StoreData> extends EventEmitter<{
  fetch  : [ data : T ]
  update : [ current : T, updated : T ]
  reset  : [ data : T ]
}> {

  private readonly _global     : GlobalController
  private readonly _defaults   : T
  private readonly _store_key  : string
  private readonly _topics     : StoreTopics
  private readonly _validator  : (data : unknown) => asserts data is T

  private _init       : boolean                 = false
  private _middleware : Set<StoreMiddleware<T>> = new Set()
  private _store      : T | null                = null

  constructor (
    scope  : GlobalInitScope,
    config : StoreConfig<T>
  ) {
    super()
    this._global     = GlobalController.fetch(scope)
    this._store_key  = config.store_key
    this._topics     = config.topics
    this._defaults   = config.defaults
    this._validator  = config.validator ?? (() => {})

    this.global.mbus.subscribe(this._handler.bind(this), { domain : this._store_key })

    this.log.info('controller initialized')
   
  }

  get data () : T {
    return this._store ?? this._defaults
  }

  get global () {
    return this._global
  }

  get is_init () : boolean {
    return this._init
  }

  get log () {
    return get_console(`[ ${this._store_key} ]`)
  }

  get topics () {
    return this._topics
  }

  _dispatch (payload : T = this.data) {
    // Send the update event to the message bus.
    this.global.mbus.send({ topic : this.topics.EVENT, payload })
  }

  async _handler (message : MessageEnvelope) {
    try {
      // If the message is not a request message, return.
      if (message.type !== 'request') return
      // Get the message topic.
      const topic = message.topic
      // Assert the message is sent to the correct store.
      Assert.ok(topic.includes(this._store_key), 'message sent to wrong store: ' + topic + ' !== ' + this._store_key)
      // Handle the message based on the action.
      switch (topic) {
        case this.topics.FETCH:
          // Fetch the store and respond with the store.
          await this.fetch()
          // Emit the fetch event.
          this.emit('fetch', this.data)
          // Respond with the store.
          this.global.mbus.respond(message.id, this.data)
          break
        case this.topics.UPDATE:
          // Get the current store.
          const current = this.data
          // Update the store.
          await this.update(message.params as Partial<T>)
          // Get the updated store.
          const updated = this.data
          // Emit the update event.
          this.emit('update', current, updated)
          // Respond with success.
          this.global.mbus.respond(message.id, true)
          break
        case this.topics.RESET:
          // Reset the store.
          await this.reset()
          // Emit the reset event.
          this.emit('reset', this.data)
          // Respond with success.
          this.global.mbus.respond(message.id, true)
          break
        default:
          this.log.error('unknown action: ' + topic)
          this.global.mbus.reject(message.id, 'unknown action: ' + topic)
          break
      }
    } catch (err) {
      // If an error occurs, reject the message.
      this.global.mbus.reject(message.id, parse_error(err))
    }
  }

  async init () {
    this.log.info('initializing store...')
    // Initialize the store.
    await this.global.db.init(this._store_key, this._defaults)
    // Set the controller to initialized.
    this._init = true
    // Load the store data.
    await this.fetch()
    // Log the store initialization.
    this.log.info('store initialized')
  }

  async fetch () : Promise<T> {
    Assert.ok(this.is_init, 'store not initialized')
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
    Assert.ok(this.is_init, 'store not initialized')
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
    Assert.ok(this.is_init, 'store not initialized')
    // Return a promise that resolves when the store is reset.
    return this.global.db.save(this._store_key, this._defaults)
  }
}
