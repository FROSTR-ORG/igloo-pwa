export type LogType = 'info' | 'error' | 'warning' | 'success' | 'sign' | 'req' | 'res' | 'ready'

export interface LogEntry {
  timestamp : number
  message   : string
  type      : string
  payload?  : any
}
