import { StoreController } from './class.js'
import { Assert }          from '@vbyte/micro-lib/assert'
import { parse_error }     from '@vbyte/micro-lib/util'

import type {
  StoreData,
  MessageEnvelope
} from '@/types/index.js'

export async function handle_store_message <T extends StoreData> (
  self : StoreController<T>,
  msg  : MessageEnvelope
) {
  try {
    // If the message is not a request message, return.
    if (msg.type !== 'request') return
    // Assert the message is sent to the correct store.
    Assert.ok(msg.topic.includes(self.store_key), 'message sent to wrong store: ' + msg.topic + ' !== ' + self.store_key)
    // Handle the message based on the action.
    switch (msg.topic) {
      case self.topics.FETCH:
        // Fetch the store and respond with the store.
        await self.fetch()
        // Respond with the store.
        self.global.mbus.accept(msg.id, self.data)
        break
      case self.topics.UPDATE:
        // Get the current store.
        const current = self.data
        // Update the store.
        await self.update(msg.params as Partial<T>)
        // Get the updated store.
        const updated = self.data
        // Emit the update event.
        self.emit('update', current, updated)
        // Respond with success.
        self.global.mbus.accept(msg.id, true)
        break
      case self.topics.RESET:
        // Reset the store.
        await self.reset()
        // Emit the reset event.
        self.emit('reset', self.data)
        // Respond with success.
        self.global.mbus.accept(msg.id, true)
        break
      default:
        self.log.error('unknown action: ' + msg.topic)
        self.global.mbus.reject(msg.id, 'unknown action: ' + msg.topic)
        break
    }
  } catch (err) {
    // If an error occurs, reject the message.
    self.global.mbus.reject(msg.id, parse_error(err))
  }
}
