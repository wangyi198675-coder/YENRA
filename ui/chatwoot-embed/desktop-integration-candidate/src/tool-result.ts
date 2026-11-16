/**
 * Tool results must be lossless JSON. This normalizes a tool's return value the
 * same way the Host requires it: `undefined` object fields are dropped, array
 * holes become `null`, and non-finite numbers become `null`.
 */
export function lossless<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
