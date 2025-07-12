import { SignerController } from './class.js'

export function get_session_status (self : SignerController) : string {
  if (self.is_ready) return 'online'
  if (self.client)   return 'connecting'
  return 'loading'
}
