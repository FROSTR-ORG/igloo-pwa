import * as CONST from '@/const.js'

import type { SignerSession }     from '@cmdcode/nostr-connect'
import type { RequestController } from './class.js'

export function register_hooks (self : RequestController) {
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

export function attach_console (self : RequestController) {
  const console = self.global.service.console
  const domain  = CONST.SYMBOLS.DOMAIN.REQUEST

  self.client.session.on('activated', (session : SignerSession) => {
    console.add({
      domain,
      message : 'session activated',
      payload : session,
      type    : 'info'
    })
  })

  self.client.session.on('revoked', (session : string) => {
    console.add({
      domain,
      message : 'session revoked',
      payload : session,
      type    : 'info'
    })
  })

  self.client.session.on('cleared', () => {
    console.add({
      domain,
      message : 'session cleared',
      type    : 'info'
    })
  })
}
