/**
 * Decode one existing YENRA Host Command envelope. Pure and dependency-free so
 * the exact behavior is unit-testable against the real implementation.
 *
 * Envelope names contain digits (`YENRA_SOCIAL_V1:`, `YENRA_WA_PREFS_V1:`), so
 * the marker class accepts A-Z, 0-9 and underscore. Only the marker is
 * stripped; the payload is never re-interpreted beyond JSON parsing.
 */
export function decodeEnvelope(text: string): Record<string, unknown> {
  const marker = /^YENRA_[A-Z0-9_]+:/u.exec(text)
  const body = marker ? text.slice(marker[0].length) : text
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error('原生回执不是有效数据')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('原生回执格式错误')
  }
  return value as Record<string, unknown>
}
