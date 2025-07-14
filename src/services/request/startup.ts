import { handle_approved_request } from './handler.js'
import { SYMBOLS }                 from '@/const.js'

import type { PermissionRequest } from '@cmdcode/nostr-connect'
import type { RequestController } from './class.js'

export function attach_hooks (self : RequestController) {
  // Update the request state on any event.
  self.client.request.on('*', () => { self._dispatch() })
  // Handle approved requests.
  self.client.request.on('approve', (req : PermissionRequest) => {
    handle_approved_request(self, req)
  })
}

export function attach_console (self : RequestController) {
  const console = self.global.service.console
  const domain  = SYMBOLS.DOMAIN.REQUEST

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
