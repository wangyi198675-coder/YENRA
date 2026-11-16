/**
 * Regression: the Chatwoot client must send the API token on every request.
 * A missing assignment produced a real 401 against the running fork, so this
 * test pins the header and forbids the token from leaking into errors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChatwootClient, ChatwootClientError } from '../src/chatwoot-client.mjs';

const TOKEN = 'test-token-123';

function client(fetchImpl) {
  return new ChatwootClient({
    baseUrl: 'http://127.0.0.1:31907',
    accountId: 1,
    token: TOKEN,
    fetchImpl,
  });
}

test('listInboxes sends api_access_token and accepts {payload:[]}', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ payload: [{ id: 2, name: 'FB Personal', channel_type: 'Channel::Api' }] }), { status: 200 });
  };

  const rows = await client(fetchImpl).listInboxes();

  assert.equal(seen.url, 'http://127.0.0.1:31907/api/v1/accounts/1/inboxes');
  assert.equal(seen.init.headers.api_access_token, TOKEN);
  assert.equal(seen.init.headers.accept, 'application/json');
  assert.deepEqual(rows, [{ id: 2, name: 'FB Personal', channelType: 'Channel::Api', avatarUrl: null }]);
});

test('HTTP errors never include the token in the message', async () => {
  const fetchImpl = async () => new Response('{}', { status: 401 });

  await assert.rejects(
    () => client(fetchImpl).listInboxes(),
    (error) => {
      assert.ok(error instanceof ChatwootClientError);
      assert.equal(error.code, 'CHATWOOT_HTTP_401');
      assert.ok(!String(error.message).includes(TOKEN));
      return true;
    }
  );
});
