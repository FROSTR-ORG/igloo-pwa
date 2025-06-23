import { get_event_id } from '@cmdcode/nostr-p2p/lib'
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

  get_methods () : string[] {
    return Object.values(SIGN_METHODS)
  }

  get_pubkey () {
    return this._node.group.group_pk.slice(2)
  }

  async sign_event (event : EventTemplate) : Promise<SignedEvent> {
    const { content, kind, tags } = event
    const created_at = now()
    const pubkey = this._node.group.group_pk.slice(2)
    const tmpl   = { content, created_at, kind, pubkey, tags }
    const id     = get_event_id(tmpl)
    const res    = await this._node.req.sign(id)
    if (!res.ok) throw new Error(res.err)
    const payload = res.data.at(0)
    if (payload?.at(0) !== id)               throw new Error('event id mismatch')
    if (payload?.at(1)?.slice(2) !== pubkey) throw new Error('event pubkey mismatch')
    const sig = payload.at(2)
    if (!sig) throw new Error('signature missing from response')
    const signed = { ...tmpl, id, sig }
    return signed
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