import { SignerController }  from './class.js'
import { SignerClient }      from '@cmdcode/nostr-connect'
import { BifrostSignDevice } from '@/class/signer.js'
import * as CONST            from '@/const.js'

const DOMAIN = CONST.SYMBOLS.DOMAIN.SIGNER

export function create_client (self : SignerController) {
  // Fetch the bifrost node from the global state.
  const node = self.global.service.node.client
  // If the node is not initialized, return an error.
  if (!node) throw new Error('bifrost node not initialized')
  // Create a new signer.
  const signer = new BifrostSignDevice(node)
  // Create a new client.
  return new SignerClient(signer, {
    sessions : self.global.service.cache.data.sessions
  })
}

export function attach_debugger (self : SignerController) {
  self.client.on('*', (event : string, ...args : unknown[]) => {
    console.log('[ signer ]', event, args)
  })
  self.client.socket.on('*', (event : string, ...args : unknown[]) => {
    console.log('[ socket ]', event, args)
  })
  self.client.session.on('*', (event : string, ...args : unknown[]) => {
    console.log('[ session ]', event, args)
  })
  self.client.request.on('*', (event : string, ...args : unknown[]) => {
    console.log('[ request ]', event, args)
  })
}

export function attach_console (self : SignerController) {
  const console = self.global.service.console

  self.client.on('ready', () => {
    console.add({
      domain  : DOMAIN,
      message : 'signer client ready',
      type    : 'info'
    })
  })

  self.client.on('error', (err : unknown) => {
    console.add({
      domain  : DOMAIN,
      message : 'signer client error',
      type    : 'error',
      payload : err
    })
  })

  self.client.on('close', () => {
    console.add({
      domain  : DOMAIN,
      message : 'signer client closed',
      type    : 'info'
    })
  })
}
