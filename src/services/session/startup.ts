import * as CONST from '@/const.js'

import type { SignerSession }     from '@cmdcode/nostr-connect'
import type { SessionController } from './class.js'

const DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION

export function attach_hooks (self : SessionController) {
  self.client.session.on('*', () => { self._dispatch() })

  self.client.session.on('revoked', () => {
    self._update()
  })

  self.client.session.on('active', () => {
    self._update()
  })

  self.client.session.on('cleared', () => {
    self._update()
  })
}

export function attach_console (self : SessionController) {

  self.client.session.on('active', (session : SignerSession) => {
    self.global.service.console.add({
      domain  : DOMAIN,
      message : 'session activated',
      payload : session,
      type    : 'info'
    })
  })

  self.client.session.on('revoked', (session : string) => {
    self.global.service.console.add({
      domain  : DOMAIN,
      message : 'session revoked',
      payload : session,
      type    : 'info'
    })
  })

  self.client.session.on('cleared', () => {
    self.global.service.console.add({
      domain  : DOMAIN,
      message : 'session cleared',
      type    : 'info'
    })
  })
}
