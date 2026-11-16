import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimePrerequisites, configSummary, loadConfig } from '../src/config.mjs';
import { FAKE_SESSION_ID } from './fixtures/synthetic.mjs';

const TOKEN = 'synthetic-api-token';

test('ENABLE_REAL_SEND is disabled unless the value is exactly "true"', () => {
  for (const value of [undefined, '', '1', 'TRUE', 'True', 'yes', ' true']) {
    const cfg = loadConfig({ CHATWOOT_API_TOKEN: TOKEN, ENABLE_REAL_SEND: value });
    assert.equal(cfg.enableRealSend, false, `value=${String(value)}`);
  }
  const enabled = loadConfig({ CHATWOOT_API_TOKEN: TOKEN, ENABLE_REAL_SEND: 'true' });
  assert.equal(enabled.enableRealSend, true);
});

test('loadConfig applies documented defaults', () => {
  const cfg = loadConfig({ CHATWOOT_API_TOKEN: TOKEN });
  assert.equal(cfg.hostBaseUrl, 'http://127.0.0.1:60474');
  assert.equal(cfg.chatwootBaseUrl, 'http://127.0.0.1:31907');
  assert.equal(cfg.chatwootAccountId, 1);
  assert.equal(cfg.bridgePort, 31917);
  assert.equal(cfg.bridgeBind, '127.0.0.1');
  assert.equal(cfg.verifyRoomBeforePost, false);
  assert.equal(cfg.dryRunInbound, false);
});

test('runtime prerequisites fail closed on a missing token or non-local Chatwoot URL', () => {
  assert.throws(() => assertRuntimePrerequisites(loadConfig({})), (error) => error.code === 'MISSING_REQUIRED_CONFIG');
  assert.throws(
    () => assertRuntimePrerequisites(loadConfig({ CHATWOOT_API_TOKEN: TOKEN, CHATWOOT_BASE_URL: 'https://chatwoot.example.com' })),
    (error) => error.code === 'CHATWOOT_BASE_URL_NOT_LOCAL',
  );
  assert.doesNotThrow(() => assertRuntimePrerequisites(loadConfig({ CHATWOOT_API_TOKEN: TOKEN })));
});

test('configSummary never contains secrets or the owner session id', () => {
  const cfg = loadConfig({
    CHATWOOT_API_TOKEN: TOKEN,
    CHATWOOT_WEBHOOK_SECRET: 'synthetic-webhook-secret',
    YENRA_HOST_OWNER_SESSION_ID: FAKE_SESSION_ID,
    ENABLE_REAL_SEND: 'true',
  });
  const text = JSON.stringify(configSummary(cfg));
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes('synthetic-webhook-secret'), false);
  assert.equal(text.includes(FAKE_SESSION_ID), false);
  assert.equal(configSummary(cfg).ownerSessionConfigured, true);
});

test('inbox map and webhook secret JSON are validated', () => {
  assert.throws(() => loadConfig({ CHATWOOT_INBOX_MAP: '{oops' }), (error) => error.code === 'INBOX_MAP_JSON_INVALID');
  assert.throws(() => loadConfig({ CHATWOOT_INBOX_MAP: '{"Personal":0}' }), (error) => error.code === 'INBOX_MAP_ID_INVALID');
  assert.throws(() => loadConfig({ CHATWOOT_WEBHOOK_SECRETS: '{"x":"y"}' }), (error) => error.code === 'WEBHOOK_SECRET_INBOX_ID_INVALID');
  assert.deepEqual(loadConfig({ CHATWOOT_INBOX_MAP: '{"Personal":2}' }).inboxMapOverride, { Personal: 2 });
  assert.deepEqual(loadConfig({ CHATWOOT_WEBHOOK_SECRETS: '{"2":"s"}' }).webhookSecretsByInbox, { 2: 's' });
});

test('invalid ports and account ids are rejected', () => {
  assert.throws(() => loadConfig({ BRIDGE_PORT: '0' }), (error) => error.code === 'BRIDGE_PORT_INVALID');
  assert.throws(() => loadConfig({ BRIDGE_PORT: '99999' }), (error) => error.code === 'BRIDGE_PORT_INVALID');
  assert.throws(() => loadConfig({ CHATWOOT_ACCOUNT_ID: '0' }), (error) => error.code === 'CHATWOOT_ACCOUNT_ID_INVALID');
});

test('manual real Sender is available only with a valid original DSH owner Session', () => {
  const unsafe = loadConfig({CHATWOOT_API_TOKEN:TOKEN,ENABLE_REAL_SEND:'true'});
  assert.throws(()=>assertRuntimePrerequisites(unsafe),
    (error)=>error.code==='DSH_OWNER_SESSION_NOT_CONFIGURED');
  const valid=loadConfig({CHATWOOT_API_TOKEN:TOKEN,ENABLE_REAL_SEND:'true',
    YENRA_HOST_OWNER_SESSION_ID:FAKE_SESSION_ID});
  assert.doesNotThrow(()=>assertRuntimePrerequisites(valid));
  assert.doesNotThrow(()=>assertRuntimePrerequisites(loadConfig({
    CHATWOOT_API_TOKEN:TOKEN,ENABLE_REAL_SEND:'false',
  })));
});
