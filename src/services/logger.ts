import { DBController } from './db.js'
import { MessageBus }   from './mbus.js'
import { LOG_LIMIT }    from '@/const.js'

import type { LogEntry, RequestMessage } from '@/types/index.js'

import SYMBOLS from '@/symbols.json' assert { type: 'json' }

export function handle_log_request (message : RequestMessage) {
  switch (message.topic) {
    case SYMBOLS.LOG.CLEAR:
      // Clear the logs from the database.
      DBController.save('logs', [])
      // Send the new logs to the clients.
      MessageBus.send({ topic : SYMBOLS.LOG.EVENT, payload : [] })
      break
  }
}

export async function add_log_entry (entry : LogEntry) {
  // Load the current logs from the database.
  let curr_logs = await DBController.load<LogEntry[]>('logs') ?? []
  // Apply the log limit.
  if (curr_logs.length > LOG_LIMIT) {
    const diff = curr_logs.length - LOG_LIMIT
    curr_logs  = curr_logs.slice(diff)
  }
  // Create the new logs array.
  const new_logs = [ ...curr_logs, entry ]
  // Save the new logs to the database.
  await DBController.save('logs', new_logs)
  // Send the new logs to the clients.
  MessageBus.send({ topic : SYMBOLS.LOG.EVENT, payload : new_logs })
}
