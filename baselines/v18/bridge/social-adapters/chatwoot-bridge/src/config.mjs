/**
 * Bridge configuration.
 *
 * Everything is explicit environment configuration: no config database, no
 * second YENRA configuration centre, no persisted state.
 *
 * Real sending is OFF unless ENABLE_REAL_SEND is exactly "true". The bridge
 * never guesses, never defaults to enabled, and never retries an unconfirmed
 * send (the Host Sender returns deliveryStatus UNKNOWN by design).
 */
import { readFileSync } from 'node:fs';
import { ContractError } from './contract.mjs';

export const CONFIG_DEFAULTS = Object.freeze({
  hostBaseUrl: 'http://127.0.0.1:60474',
  hostTimeoutMs: 20000,
  chatwootBaseUrl: 'http://127.0.0.1:31907',
  chatwootAccountId: 1,
  bridgeBind: '127.0.0.1',
  bridgePort: 31917,
  freshnessMinutes: 15,
  historyAgeMinutes: 60,
  concurrency: 4,
  webhookToleranceSeconds: 300,
  logLevel: 'info',
});

function asInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function asBool(value) {
  return value === true || value === 'true' || value === '1';
}

/** Read a secret from an env var, or from a file path given by <NAME>_FILE. */
function readSecret(env, name) {
  const filePath = env[`${name}_FILE`];
  if (typeof filePath === 'string' && filePath.trim()) {
    try {
      return readFileSync(filePath.trim(), 'utf8').trim();
    } catch {
      throw new ContractError('SECRET_FILE_UNREADABLE', name);
    }
  }
  return typeof env[name] === 'string' ? env[name] : '';
}

/** Parse CHATWOOT_INBOX_MAP JSON: {"Personal":"2"} or {accountRef: inboxId}. */
function parseInboxMap(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractError('INBOX_MAP_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContractError('INBOX_MAP_NOT_OBJECT');
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ContractError('INBOX_MAP_ID_INVALID', key);
    out[key] = id;
  }
  return out;
}

/** Parse CHATWOOT_WEBHOOK_SECRETS JSON: {"2":"s1","3":"s2"} (inbox id -> secret). */
function parseWebhookSecrets(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractError('WEBHOOK_SECRETS_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContractError('WEBHOOK_SECRETS_NOT_OBJECT');
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ContractError('WEBHOOK_SECRET_INBOX_ID_INVALID', key);
    if (typeof value !== 'string' || !value) throw new ContractError('WEBHOOK_SECRET_EMPTY', key);
    out[id] = value;
  }
  return out;
}

/** Parse BRIDGE_ALLOW_CIDR JSON list, e.g. ["172.16.0.0/12"]. */
function parseCidrs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ContractError('ALLOW_CIDR_JSON_INVALID');
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new ContractError('ALLOW_CIDR_NOT_STRING_ARRAY');
  }
  return parsed;
}

/**
 * @param {Record<string,string|undefined>} [env]
 * @returns {object} frozen config object
 */
export function loadConfig(env = process.env) {
  const cfg = {
    hostBaseUrl: env.YENRA_HOST_BASE_URL ?? CONFIG_DEFAULTS.hostBaseUrl,
    hostTimeoutMs: asInt(env.YENRA_HOST_TIMEOUT_MS, CONFIG_DEFAULTS.hostTimeoutMs),
    chatwootBaseUrl: env.CHATWOOT_BASE_URL ?? CONFIG_DEFAULTS.chatwootBaseUrl,
    chatwootAccountId: asInt(env.CHATWOOT_ACCOUNT_ID, CONFIG_DEFAULTS.chatwootAccountId),
    chatwootApiToken: readSecret(env, 'CHATWOOT_API_TOKEN'),
    chatwootTimeoutMs: asInt(env.CHATWOOT_TIMEOUT_MS, 20000),
    inboxMapOverride: parseInboxMap(env.CHATWOOT_INBOX_MAP),
    webhookSecret: readSecret(env, 'CHATWOOT_WEBHOOK_SECRET'),
    webhookSecretsByInbox: parseWebhookSecrets(env.CHATWOOT_WEBHOOK_SECRETS),
    webhookToleranceSeconds: asInt(env.BRIDGE_WEBHOOK_TOLERANCE_SECONDS, CONFIG_DEFAULTS.webhookToleranceSeconds),
    bridgeBind: env.BRIDGE_BIND ?? CONFIG_DEFAULTS.bridgeBind,
    bridgePort: asInt(env.BRIDGE_PORT, CONFIG_DEFAULTS.bridgePort),
    allowCidrs: parseCidrs(env.BRIDGE_ALLOW_CIDR),
    freshnessMinutes: asInt(env.BRIDGE_FRESHNESS_MINUTES, CONFIG_DEFAULTS.freshnessMinutes),
    historyAgeMinutes: asInt(env.BRIDGE_HISTORY_AGE_MINUTES, CONFIG_DEFAULTS.historyAgeMinutes),
    concurrency: asInt(env.BRIDGE_CONCURRENCY, CONFIG_DEFAULTS.concurrency),
    verifyRoomBeforePost: asBool(env.BRIDGE_VERIFY_ROOM),
    dryRunInbound: asBool(env.BRIDGE_DRY_RUN),
    enableRealSend: env.ENABLE_REAL_SEND === 'true',
    hostOwnerSessionId: env.YENRA_HOST_OWNER_SESSION_ID ?? '',
    logLevel: env.BRIDGE_LOG_LEVEL ?? CONFIG_DEFAULTS.logLevel,
  };
  if (!Number.isSafeInteger(cfg.chatwootAccountId) || cfg.chatwootAccountId <= 0) {
    throw new ContractError('CHATWOOT_ACCOUNT_ID_INVALID');
  }
  if (!Number.isSafeInteger(cfg.bridgePort) || cfg.bridgePort <= 0 || cfg.bridgePort > 65535) {
    throw new ContractError('BRIDGE_PORT_INVALID');
  }
  return Object.freeze(cfg);
}

/** Startup prerequisites for anything that would touch Chatwoot. */
export function assertRuntimePrerequisites(cfg) {
  // Native Chatwoot claim/MID/ACK endpoints are now wired and validated in
  // the running Rails + Bridge. Never block manual original Sender use just
  // because an older isolated build lacked durable storage.
  // Sending is opt-in ONCE at launch, and the original DSH Host still checks
  // the owner's real current Session on EVERY platform send request.
  if (cfg.enableRealSend === true &&
      (typeof cfg.hostOwnerSessionId !== 'string' ||
       !/^session-[a-f0-9-]{36}$/u.test(cfg.hostOwnerSessionId))) {
    throw new ContractError('DSH_OWNER_SESSION_NOT_CONFIGURED');
  }
  const missing = [];
  if (!cfg.chatwootApiToken) missing.push('CHATWOOT_API_TOKEN');
  if (!cfg.chatwootBaseUrl) missing.push('CHATWOOT_BASE_URL');
  if (missing.length) throw new ContractError('MISSING_REQUIRED_CONFIG', missing.join(','));
  if (!/^https?:\/\/127\.0\.0\.1(:\d+)?$/u.test(cfg.chatwootBaseUrl) &&
      !/^https?:\/\/localhost(:\d+)?$/u.test(cfg.chatwootBaseUrl)) {
    // The candidate inbox is local-only; a remote URL must be a deliberate edit.
    throw new ContractError('CHATWOOT_BASE_URL_NOT_LOCAL');
  }
}

/**
 * Safe summary for startup logs: never includes the API token, webhook
 * secrets, owner session id or any scope identifier.
 */
export function configSummary(cfg) {
  return {
    hostBaseUrl: cfg.hostBaseUrl,
    chatwootBaseUrl: cfg.chatwootBaseUrl,
    chatwootAccountId: cfg.chatwootAccountId,
    bridge: `${cfg.bridgeBind}:${cfg.bridgePort}`,
    webhookSecretConfigured: Boolean(cfg.webhookSecret) || Object.keys(cfg.webhookSecretsByInbox).length > 0,
    inboxMapOverrideEntries: Object.keys(cfg.inboxMapOverride).length,
    allowCidrs: cfg.allowCidrs,
    enableRealSend: cfg.enableRealSend,
    ownerSessionConfigured: Boolean(cfg.hostOwnerSessionId),
    verifyRoomBeforePost: cfg.verifyRoomBeforePost,
    dryRunInbound: cfg.dryRunInbound,
    freshnessMinutes: cfg.freshnessMinutes,
    concurrency: cfg.concurrency,
  };
}
