import { MESSAGE } from '@/const.js'

// Declare the service worker global scope
declare const self: ServiceWorkerGlobalScope

// Helper function to create error response
function create_error_msg (id: string, error: string) {
  return { type : MESSAGE.ERROR, id, error }
}

// Helper function to create success response
function create_data_msg (type: string, id: string) {
  const data = { success: true }
  return { type, id, data }
}

// Helper function to send a response to the client
async function send_response (response: any) {
  console.log('[ sw/bus ] sending response to client', JSON.stringify(response, null, 2))

  // Get all clients
  const clients = await self.clients.matchAll()
  
  // Send the response to all clients
  for (const client of clients) {
    client.postMessage(response)
  }
}

export async function handle_message (message: any) {
  const { type, id } = message
  
  // Validate message structure
  if (!type || !id) {
    console.error('[ sw/bus ] invalid message', message)
    await send_response(create_error_msg(id || 'unknown', 'invalid message'))
    return
  }
  
  console.log('[ sw/bus ] received message', JSON.stringify(message, null, 2))
  
  switch (type) {
    case MESSAGE.CONNECT: {
      // Send success response
      const response = create_data_msg(MESSAGE.CONNECT, id)
      await send_response(response)
      break
    }
    
    case MESSAGE.DISCONNECT: {
      // Send success response
      const response = create_data_msg(MESSAGE.DISCONNECT, id)
      await send_response(response)
      break
    }
    
    default:
      throw new Error(`Unsupported message type: ${type}`)
  }
}
