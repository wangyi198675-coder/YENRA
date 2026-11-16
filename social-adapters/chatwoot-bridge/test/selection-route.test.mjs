import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeServer } from '../src/server.mjs';
import { silentLogger } from '../src/logger.mjs';
import { createRequestShim, createResponseShim } from './fixtures/synthetic.mjs';

function buildServer(resolveSelection) {
  const outbound = { async handle() { return { status: 200, body: { ok: true } }; } };
  return createBridgeServer({ outbound, logger: silentLogger, health: () => ({}), resolveSelection });
}

test('GET /selection resolves via the injected resolver', async () => {
  const { handleRequest } = buildServer(async ({ accountId, displayId }) => {
    assert.equal(accountId, 1);
    assert.equal(displayId, 123);
    return { ok: true, selection: { accountRef: 'a'.repeat(32), roomRef: 'b'.repeat(32), channel: 'Personal' } };
  });
  const response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection?accountId=1&displayId=123' }), response);
  assert.equal(response.state.status, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().selection.channel, 'Personal');
});

test('GET /selection maps a failed resolve to 404', async () => {
  const { handleRequest } = buildServer(async () => ({ ok: false, error: 'IDENTIFIER_NOT_IN_ROSTER' }));
  const response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection?accountId=1&displayId=9' }), response);
  assert.equal(response.state.status, 404);
  assert.equal(response.json().error, 'IDENTIFIER_NOT_IN_ROSTER');
});

test('GET /selection rejects missing or invalid ids', async () => {
  const { handleRequest } = buildServer(async () => ({ ok: true }));
  let response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection' }), response);
  assert.equal(response.state.status, 400);

  response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection?accountId=1' }), response);
  assert.equal(response.state.status, 400);

  response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'POST', url: '/selection?accountId=1&displayId=1' }), response);
  assert.equal(response.state.status, 405);
});

test('GET /selection returns 501 when no resolver is configured', async () => {
  const outbound = { async handle() { return { status: 200, body: {} }; } };
  const { handleRequest } = createBridgeServer({ outbound, logger: silentLogger });
  const response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection?accountId=1&displayId=1' }), response);
  assert.equal(response.state.status, 501);
});

test('loopback origin gets a CORS header, a remote origin does not', async () => {
  const { handleRequest } = buildServer(async () => ({ ok: true }));
  let response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection?accountId=1&displayId=1', headers: { origin: 'http://127.0.0.1:60474' } }), response);
  assert.equal(response.state.headers['access-control-allow-origin'], 'http://127.0.0.1:60474');

  response = createResponseShim();
  await handleRequest(createRequestShim({ method: 'GET', url: '/selection?accountId=1&displayId=1', headers: { origin: 'https://evil.example' } }), response);
  assert.equal('access-control-allow-origin' in response.state.headers, false);
});
