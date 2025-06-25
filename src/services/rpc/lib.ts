import { RpcController } from './class.js'

export function get_session_status (self : RpcController) : string {
  if (self.is_ready) return 'online'
  if (self.client)   return 'connecting'
  return 'loading'
}
