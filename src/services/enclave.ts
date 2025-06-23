import * as CONST           from '@/const.js'
import { EventEmitter }     from '@/class/emitter.js'
import { get_console }      from '@/lib/logger.js'
import { Assert, JsonUtil } from '@/util/index.js'
import { GlobalController } from '@/core/global.js'

import {
  decrypt_secret,
  encrypt_secret,
} from '@/lib/crypto.js'

import type {
  GlobalInitScope,
  MessageEnvelope,
  PrivateStore
} from '@/types/index.js'

const ENCLAVE_DOMAIN = CONST.SYMBOLS.DOMAIN.ENCLAVE
const ENCLAVE_TOPIC  = CONST.SYMBOLS.TOPIC.ENCLAVE

const DEFAULT_STORE : PrivateStore = { share : null }

export class EnclaveController extends EventEmitter<{
  locked   : any[]
  unlocked : any[]
}> {
  private readonly _global : GlobalController
  
  private _store : PrivateStore | null = null

  constructor (scope : GlobalInitScope) {
    super()
    this._global = GlobalController.fetch(scope)
  }

  get data () : string | null {
    return this.global.scope.private
  }

  get global () {
    return this._global
  }

  get is_locked () : boolean {
    return !!this.data && !this.is_ready
  }

  get is_ready () : boolean {
    return this._store !== null
  }

  get log () {
    return get_console('[ enclave ]')
  }

  get store () : PrivateStore {
    // If the enclave is locked, throw an error.
    Assert.ok(this.is_locked, 'enclave is locked')
    // Return the enclave store.
    return this._store ?? DEFAULT_STORE
  }

  private _dispatch (status : string) : void {
    this.global.mbus.send({ topic : ENCLAVE_TOPIC.EVENT, payload : status })
  }

  public init () {
    const filter = { domain : ENCLAVE_DOMAIN, type : 'request' }
    this.global.mbus.subscribe(msg => handle_message(this, msg), filter)
    this.log.info('controller initialized')
  }

  public lock () : void {
    // Clear the private store.
    this._store = null
    // Dispatch the event to the global state.
    this.emit('locked')
    this._dispatch('locked')
    this.log.info('enclave locked')
  }

  public save (
    entries  : Partial<PrivateStore>,
    password : string
  ) : string | null {
    // If the password is not present, return an error.
    if (!password)      return 'password is required'
    // If the enclave is locked, return an error.
    if (this.is_locked) return 'enclave is locked'
    // Create a new enclave store with the updated entries.
    const updated = { ...this.store, ...entries }
    // Serialize the store.
    const json = JsonUtil.serialize(updated)
    // If the store is not serializable, return an error.
    if (!json) return 'failed to serialize store'
    // Encrypt the store with the password.
    const encrypted = encrypt_secret(json, password)
    // If the encrypted store is not present, return an error.
    if (!encrypted) return 'failed to encrypt store'
    // Update the global private store.
    this.global.scope.private = encrypted
    // Return null on success.
    return null
  }

  public unlock (password : string) : string | null {
    // If password is not a string, return error.
    if (typeof password !== 'string') return 'password is not a string'
    // If the encrypted data is not present, return error.
    if (!this.data)    return 'encrypted data not present'
    // If the enclave is already unlocked, return error.
    if (this.is_ready) return 'enclave already unlocked'
    // Try to decrypt the secret share.
    const decrypted = decrypt_secret(this.data, password)
    // If the decryption failed, return error.
    if (!decrypted) return 'failed to decrypt private data'
    // Try to parse the decrypted data.
    const parsed = parse_private_store(decrypted)
    // If the parsing failed, return error.
    if (!parsed) return 'failed to parse private data'
    // Update the private store.
    this._store = parsed
    // Return null on success.
    return null
  }
}

function handle_message (
  ctrl : EnclaveController,
  msg  : MessageEnvelope
) : void {
  // If the message is not a string, return.
  if (msg.type !== 'request') return
  switch (msg.topic) {
    case ENCLAVE_TOPIC.LOCK:
      ctrl.lock()
      ctrl.global.mbus.respond(msg.id, true)
      break
    case ENCLAVE_TOPIC.UNLOCK:
      if (typeof msg.params !== 'string') {
        ctrl.global.mbus.reject(msg.id, 'password is not a string')
        break
      }
      ctrl.unlock(msg.params)
      ctrl.global.mbus.respond(msg.id, true)
      break
  }
}

function parse_private_store (
  store : unknown
) : PrivateStore | null {
  // If the store is not a string, return null.
  if (typeof store !== 'string') return null
  // TODO: Implement schema validation here.
  return JsonUtil.parse(store)
}
