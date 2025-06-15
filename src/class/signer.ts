import { getEventHash } from 'nostr-tools'
import { BifrostNode }  from '@frostr/bifrost'
import * as cipher      from '@/crypto/cipher.js'
import { now }          from '@/util/helpers.js'

import type { SignedEvent, SignerDeviceAPI } from '@cmdcode/nostr-connect'
import type { EventTemplate }                from 'nostr-tools'

const SIGN_METHODS : Record<string, string> = {
  sign_event    : 'sign_event',
  nip04_encrypt : 'nip04_encrypt',
  nip04_decrypt : 'nip04_decrypt',
  nip44_encrypt : 'nip44_encrypt',
  nip44_decrypt : 'nip44_decrypt'
}

export class BifrostSignDevice implements SignerDeviceAPI {
  private _node : BifrostNode

  constructor (node : BifrostNode) {
    this._node = node
  }

  async get_methods () {
    return SIGN_METHODS
  }

  async get_pubkey () {
    return this._node.group.group_pk
  }

  async sign_event (event : EventTemplate) : Promise<SignedEvent> {
    const { content, kind, tags } = event
    const created_at = now()
    const pubkey = this._node.group.group_pk
    const tmpl   = { content, created_at, kind, pubkey, tags }
    const id     = getEventHash(tmpl)
    const res    = await this._node.req.sign(id, tmpl)
    if (!res.ok) throw new Error(res.err)
    const sig    = res.data.at(0)?.at(0)
    if (!sig) throw new Error('signature missing from response')
    return { ...tmpl, id, sig }
  }

  async nip04_encrypt (pubkey : string, plaintext : string) : Promise<string> {
    const res = await this._node.req.ecdh(pubkey)
    if (!res.ok) throw new Error(res.err)
    return cipher.nip04_encrypt(res.data, plaintext)
  }

  async nip04_decrypt (pubkey : string, ciphertext : string) : Promise<string> {
    const res = await this._node.req.ecdh(pubkey)
    if (!res.ok) throw new Error(res.err)
    return cipher.nip04_decrypt(res.data, ciphertext)
  }

  async nip44_encrypt (pubkey : string, plaintext : string) : Promise<string> {
    const res = await this._node.req.ecdh(pubkey)
    if (!res.ok) throw new Error(res.err)
    return cipher.nip44_encrypt(res.data, plaintext)
  }

  async nip44_decrypt (pubkey : string, ciphertext : string) : Promise<string> {
    const res = await this._node.req.ecdh(pubkey)
    if (!res.ok) throw new Error(res.err)
    return cipher.nip44_decrypt(res.data, ciphertext)
  }
}