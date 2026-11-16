/** Pure configuration validation shared by Host, Client and synthetic QA. */
export const DEFAULT_ORIGIN = 'http://127.0.0.1:31908'
export const DEFAULT_BRIDGE_ORIGIN = 'http://127.0.0.1:31917'
export const DEFAULT_NAMESPACE = 'yenra-chatwoot-embed'
export function validateOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('origin must be an HTTP loopback origin without path, query or credentials')
  }
  return url.origin
}
