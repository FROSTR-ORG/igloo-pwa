export namespace JsonUtil {
  export const parse     = parse_json
  export const normalize = normalize_obj
  export const serialize = serialize_json
  export const copy      = deep_copy
  export const is_equal  = deep_equal
}

type JsonReplacer = (key : string, value : unknown) => unknown
type JsonReviver  = (key : string, value : unknown) => unknown

const REPLACER : JsonReplacer = (_: string, value: any) => {
  if (value === null || value === undefined) return value
  if (value instanceof Map) {
    return { __type: 'map', data: Array.from(value.entries()) }
  }
  else if (value instanceof Set) {
    return { __type: 'set', data: Array.from(value.entries()) }
  }
  else if (value instanceof Date) {
    return { __type: 'date', data: value.toISOString() }
  }
  return value
}

const REVIVER : JsonReviver = (_: string, value: any) => {
  if (value === null || value === undefined) return value
  if (typeof value === 'object' && value.__type === 'map') {
    return new Map(value.data)
  }
  else if (typeof value === 'object' && value.__type === 'set') {
    return new Set(value.data)
  }
  else if (typeof value === 'object' && value.__type === 'date') {
    return new Date(value.data)
  }
  return value
}

function serialize_json <T = Record<string, unknown>> (
  json_obj : T,
  replacer : JsonReplacer = REPLACER
) : string | null {
  try {
    const normalized = normalize_obj(json_obj)
    return JSON.stringify(normalized, replacer)
  } catch {
    return null
  }
}

function normalize_obj <
  T extends Record<keyof T, any>
> (obj : T) : T {
  if (obj instanceof Map || Array.isArray(obj) || typeof obj !== 'object') {
    return obj
  } else {
    return Object.keys(obj)
      .sort()
      .filter(([ _, value ]) => value !== undefined)
      .reduce<Record<string, any>>((sorted, key) => {
        sorted[key] = obj[key as keyof T]
        return sorted
      }, {}) as T
  }
}

function parse_json <T = Record<string, unknown>> (
  json_str : string,
  reviver  : JsonReviver = REVIVER
) : T | null {
  try {
    const parsed = JSON.parse(json_str, reviver)
    return normalize_obj(parsed)
  } catch (error) {
    return null
  }
}

function deep_copy <T = Record<string, unknown>> (
  json_obj : T,
  replacer : JsonReplacer = REPLACER,
  reviver  : JsonReviver  = REVIVER
) : T {
  // Use JSON serialization with custom replacer and reviver
  const json_str = JSON.stringify(json_obj, replacer)
  return JSON.parse(json_str, reviver) as T
}

function deep_equal (obj_a : Object, obj_b : Object) {
  // If both objects are null, return true.
  if (obj_a === null && obj_b === null) return true
  // Normalize both objects and compare as strings.
  return String(normalize_obj(obj_a)) === String(normalize_obj(obj_b))
}