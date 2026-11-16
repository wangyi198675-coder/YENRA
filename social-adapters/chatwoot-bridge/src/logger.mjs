/**
 * Structured bridge logger.
 *
 * Privacy boundary: this adapter sees real contact names, phone numbers,
 * message text and scope identifiers. None of them may be printed.
 * - text/content/body/name/phone/token/secret/session fields are redacted;
 * - scope refs are masked to a short prefix + suffix;
 * - only counts, booleans, error codes and masked refs are emitted.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys that must never reach a log sink, even when passed accidentally. */
const FORBIDDEN_KEYS = new Set([
  'text', 'content', 'body', 'message', 'messages', 'name', 'displayName',
  'phone', 'phoneFallback', 'latestText', 'latestMessageSource', 'token',
  'apiToken', 'api_access_token', 'secret', 'sessionId', 'authorization',
  'identifier', 'avatar', 'media', 'bytes', 'rawBody', 'email',
]);

/** Mask a 32-hex scope ref so operators can correlate without exposing it. */
export function maskRef(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.length <= 10) return '***';
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

function safeValue(key, value, depth) {
  if (FORBIDDEN_KEYS.has(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (key.endsWith('Ref')) return maskRef(value);
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 3) return '[object]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => safeValue('item', item, depth + 1));
  }
  if (typeof value === 'object') return safeObject(value, depth + 1);
  return String(value).slice(0, 80);
}

function safeObject(input, depth = 0) {
  const out = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    out[key] = safeValue(key, value, depth);
  }
  return out;
}

/**
 * @param {object} [options]
 * @param {'debug'|'info'|'warn'|'error'} [options.level]
 * @param {{debug:Function,info:Function,warn:Function,error:Function}} [options.sink]
 * @param {() => string} [options.now]
 */
export function createLogger({ level = 'info', sink = console, now = () => new Date().toISOString() } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(current, event, fields = {}) {
    if (LEVELS[current] < threshold) return;
    const record = { at: now(), level: current, scope: 'yenra-chatwoot-bridge', event, ...safeObject(fields) };
    let line;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ at: record.at, level: current, event, fields: '[unserializable]' });
    }
    const emit = sink?.[current];
    if (typeof emit === 'function') emit.call(sink, line);
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    level,
  };
}

/** Logger that discards everything (used by pure unit tests). */
export const silentLogger = createLogger({ level: 'error', sink: { debug() {}, info() {}, warn() {}, error() {} } });

export { FORBIDDEN_KEYS };
