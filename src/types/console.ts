export type LogType = 'info' | 'debug' | 'error' | 'warn'

export interface LogTemplate {
  domain   : string
  message  : string
  payload? : any
  stamp?   : number
  type?    : LogType
}

export interface LogFilter {
  domain? : string
  type?   : LogType
  limit?  : number
}

export interface LogEntry {
  domain   : string
  message  : string
  payload? : any
  stamp    : number
  type     : LogType
}
