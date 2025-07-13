import * as CONST from '@/const.js'

import type { SignerSession }     from '@cmdcode/nostr-connect'
import type { SessionController } from './class.js'

const DOMAIN = CONST.SYMBOLS.DOMAIN.SESSION

export function register_hooks (self : SessionController) {
  // Attach the session state handler.
  self.client.session.on('activated', () => {
    // Update the session in the cache.
    self.global.cache.update({
      sessions : self.client.session.active
    })
    // Dispatch the session state.
    self._dispatch()
  })
}

export function attach_console (self : SessionController) {
  const console = self.global.service.console
  

  self.client.session.on('activated', (session : SignerSession) => {
    console.add({
      domain  : DOMAIN,
      message : 'session activated',
      payload : session,
      type    : 'info'
    })
  })

  self.client.session.on('revoked', (session : string) => {
    console.add({
      domain  : DOMAIN,
      message : 'session revoked',
      payload : session,
      type    : 'info'
    })
  })

  self.client.session.on('cleared', () => {
    console.add({
      domain  : DOMAIN,
      message : 'session cleared',
      type    : 'info'
    })
  })
}
