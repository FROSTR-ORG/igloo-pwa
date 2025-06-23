export type LogType = 'info' | 'debug' | 'error' | 'warn'

export interface LogTemplate {
  message  : string
  payload? : any
  stamp?   : number
  topic    : string
  type?    : LogType
}

export interface LogFilter {
  topic? : string
  type?  : LogType
  limit? : number
}

export interface LogEntry {
  message  : string
  payload? : any
  stamp    : number
  topic    : string
  type     : LogType
}
