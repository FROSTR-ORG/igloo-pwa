import { handle_approved_request } from './handler.js'
import * as CONST                  from '@/const.js'

import type { PermissionRequest } from '@cmdcode/nostr-connect'
import type { RequestController } from './class.js'

export function register_hooks (self : RequestController) {
  // Attach the session state handler.
  self.client.request.on('prompt', () => { self._dispatch() })

  self.client.request.on('approve', (req : PermissionRequest) => {
    handle_approved_request(self, req)
    self._dispatch()
  })

  self.client.request.on('deny', () => { self._dispatch() })
}

export function attach_console (self : RequestController) {
  const console = self.global.service.console
  const domain  = CONST.SYMBOLS.DOMAIN.REQUEST

  self.client.request.on('prompt', (request : PermissionRequest) => {
    console.add({
      domain,
      message : 'request recieved',
      payload : request,
      type    : 'info'
    })
  })

  self.client.request.on('approve', (request : PermissionRequest) => {
    console.add({
      domain,
      message : 'request approved',
      payload : request,
      type    : 'info'
    })
  })

  self.client.request.on('deny', (request : PermissionRequest, reason : string) => {
    console.add({
      domain,
      message : 'request denied: ' + reason,
      payload : request,
      type    : 'info'
    })
  })
}
