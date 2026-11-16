import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeServer, ipv4InCidr, isAllowedSource } from '../src/server.mjs';
import { silentLogger } from '../src/logger.mjs';
import { createRequestShim, createResponseShim } from './fixtures/synthetic.mjs';

function buildServer({ handler = null, captured = [] } = {}) {
  const outbound = {
    async handle(input) {
      captured.push(input);
      if (handler) return handler(input);
      return { status: 200, body: { ok: true, submitted: false } };
    },
  };
  return { ...createBridgeServer({ outbound, logger: silentLogger, health: () => ({ mode: 'REAL_SEND_DISABLED', inbound: { posted: 3 } }) }), captured };
}

test('ipv4InCidr and isAllowedSource enforce loopback plus explicit CIDRs', () => {
  assert.equal(ipv4InCidr('172.18.0.2', '172.16.0.0/12'), true);
  assert.equal(ipv4InCidr('10.1.2.3', '172.16.0.0/12'), false);
  assert.equal(ipv4InCidr('127.0.0.1', '0.0.0.0/0'), true);
  assert.equal(ipv4InCidr('not-an-ip', '172.16.0.0/12'), false);

  assert.equal(isAllowedSource('127.0.0.1'), true);
  assert.equal(isAllowedSource('::1'), true);
  assert.equal(isAllowedSource('::ffff:192.168.1.5'), false);
  assert.equal(isAllowedSource('172.18.0.2'), false);
  assert.equal(isAllowedSource('172.18.0.2', ['172.16.0.0/12']), true);
});

test('GET /healthz returns a safe snapshot', async () => {
  const { handleRequest } = buildServer();
  const response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/healthz' }), response);
  assert.equal(response.state.status, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'REAL_SEND_DISABLED');
  assert.equal(body.inbound.posted, 3);
  assert.equal('token' in body, false);
});

test('POST /webhooks/chatwoot forwards raw body and headers to the outbound handler', async () => {
  const captured = [];
  const { handleRequest } = buildServer({
    captured,
    handler: async () => ({ status: 202, body: { ok: true, status: 'SKIPPED_REAL_SEND_DISABLED' } }),
  });
  const rawBody = '{"event":"message_created"}';
  const response = createResponseShim();
  await handleRequest(
    createRequestShim({
      method: 'POST',
      url: '/webhooks/chatwoot',
      headers: { 'content-type': 'application/json', 'x-chatwoot-timestamp': '1700000000' },
      body: rawBody,
    }),
    response,
  );
  assert.equal(response.state.status, 202);
  assert.equal(response.json().status, 'SKIPPED_REAL_SEND_DISABLED');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].rawBody, rawBody);
  assert.equal(captured[0].headers['x-chatwoot-timestamp'], '1700000000');
});

test('the bridge webhook route rejects wrong method, wrong content type and unknown routes', async () => {
  const { handleRequest } = buildServer();
  let response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/webhooks/chatwoot' }), response);
  assert.equal(response.state.status, 405);

  response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'POST', url: '/webhooks/chatwoot', headers: { 'content-type': 'text/plain' }, body: '{}' }), response);
  assert.equal(response.state.status, 415);

  response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/api/yenra/social-read' }), response);
  assert.equal(response.state.status, 404);
});

test('the bridge webhook route rejects non-loopback peers unless whitelisted', async () => {
  const { handleRequest } = buildServer();
  let response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'POST', url: '/webhooks/chatwoot', remoteAddress: '192.168.1.9', headers: { 'content-type': 'application/json' }, body: '{}' }), response);
  assert.equal(response.state.status, 403);
  assert.equal(response.json().error, 'LOCAL_ONLY');
});

test('an unexpected handler crash becomes a safe 500 without text echo', async () => {
  const { handleRequest } = buildServer({
    handler: async () => {
      throw Object.assign(new Error('synthetic crash'), { code: 'SYNTHETIC_CRASH' });
    },
  });
  const response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'POST', url: '/webhooks/chatwoot', headers: { 'content-type': 'application/json' }, body: '{}' }), response);
  assert.equal(response.state.status, 500);
  assert.equal(response.json().willRetryAutomatically, false);
  assert.equal(JSON.stringify(response.json()).includes('synthetic crash'), false);
});

test('Page contact open accepts only a verified iframe-originated POST and returns no scope refs', async () => {
  const seen = [];
  const { handleRequest } = createBridgeServer({
    outbound: { handle: async () => ({ status: 202, body: { ok: true } }) },
    logger: silentLogger,
    openPageContact: async ({ accountId, contactId }) => {
      seen.push({ accountId, contactId });
      return { ok: true, imported: 2, conversationDisplayId: 471 };
    },
  });
  const headers = {
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:31908',
    'x-yenra-page-contact-click': '1',
  };
  const body = JSON.stringify({ accountId: 1, contactId: 19 });
  let response = createResponseShim();
  await handleRequest(createRequestShim({
    method: 'POST', url: '/page-contact/open', headers, body,
  }), response);
  assert.equal(response.state.status, 200);
  assert.equal(response.json().conversationDisplayId, 471);
  assert.equal(JSON.stringify(response.json()).includes('accountRef'), false);
  assert.deepEqual(seen, [{ accountId: 1, contactId: 19 }]);

  for (const invalid of [
    { ...headers, origin: 'https://attacker.example' },
    { ...headers, 'x-yenra-page-contact-click': '0' },
    { ...headers, 'content-type': 'text/plain' },
  ]) {
    response = createResponseShim();
    await handleRequest(createRequestShim({
      method: 'POST', url: '/page-contact/open', headers: invalid, body,
    }), response);
    assert.equal(response.state.status, 403);
  }
  response = createResponseShim();
  await handleRequest(createRequestShim({
    method: 'POST', url: '/page-contact/open', headers,
    body: JSON.stringify({ accountId: 1, contactId: -4 }),
  }), response);
  assert.equal(response.state.status, 400);
  assert.equal(seen.length, 1);
});
