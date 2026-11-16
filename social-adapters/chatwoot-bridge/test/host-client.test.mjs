import test from 'node:test';
import assert from 'node:assert/strict';
import { HostClient, SseParser, classifySseFrame, normalizeRoster, parseFrame } from '../src/host-client.mjs';
import { RAW_ROSTER, REF_A, REF_B } from './fixtures/synthetic.mjs';

test('SseParser assembles frames split across chunks and tolerates CRLF', () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push(': original-dsh-im-ready\n\n'), [{ comments: ['original-dsh-im-ready'] }]);
  const first = parser.push('event: delivery-ack\ndata: {"mid":"$m"}\n');
  assert.equal(first.length, 0);
  const second = parser.push('\ndata: second\r\n\r\n');
  assert.equal(second.length, 2);
  assert.equal(second[0].event, 'delivery-ack');
  assert.equal(second[0].data, '{"mid":"$m"}');
  assert.equal(second[1].data, 'second');
});

test('SseParser joins multi-line data and flushes a trailing frame', () => {
  const parser = new SseParser();
  const frames = parser.push('data: {"a":1,\ndata: "b":2}\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, '{"a":1,\n"b":2}');
  assert.equal(JSON.parse(frames[0].data).b, 2);
  const flushed = parser.push('data: {"pending":true}').length === 0 ? parser.flush() : [];
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].data, '{"pending":true}');
});

test('parseFrame ignores keep-alive comments only frames', () => {
  assert.deepEqual(parseFrame(': yenra-live'), { comments: ['yenra-live'] });
  assert.equal(parseFrame(''), null);
});

test('classifySseFrame routes inbound rows, ACKs and baseline previews', () => {
  const inbound = classifySseFrame({ data: JSON.stringify({ accountRef: REF_A, roomRef: REF_B, mid: '$m', text: 'x', direction: 'INBOUND', timestamp: 1 }) });
  assert.equal(inbound.kind, 'message');
  assert.equal(inbound.row.mid, '$m');

  assert.equal(classifySseFrame({ event: 'personal-preview', data: '{"kind":"preview"}' }).reason, 'PERSONAL_BASELINE_PREVIEW');
  assert.equal(classifySseFrame({ data: JSON.stringify({ kind: 'preview', direction: 'INBOUND' }) }).reason, 'PERSONAL_PREVIEW_ROW');
  assert.equal(classifySseFrame({ data: JSON.stringify({ direction: 'OUTBOUND' }) }).reason, 'NOT_INBOUND');
  assert.equal(classifySseFrame({ event: 'mystery', data: '{}' }).reason, 'UNKNOWN_NAMED_EVENT');
  assert.equal(classifySseFrame({ data: 'not json' }).reason, 'SSE_DATA_NOT_JSON');
  assert.equal(classifySseFrame({ comments: ['x'] }).reason, 'COMMENT_OR_HEARTBEAT');

  const ack = classifySseFrame({ event: 'delivery-ack', data: JSON.stringify({ accountRef: REF_A, roomRef: REF_B, mid: '$m', ackKind: 'READ' }) });
  assert.equal(ack.kind, 'ack');
  assert.equal(ack.ack.channel, 'WhatsApp');
  assert.equal(ack.ack.ackKind, 'READ');
});

test('normalizeRoster assigns WhatsApp ordinals in roster order and keeps names locally', () => {
  const roster = normalizeRoster(RAW_ROSTER);
  assert.equal(roster.accounts.length, 4);
  assert.deepEqual(
    roster.accounts.map((account) => [account.channel, account.whatsappOrdinal]),
    [
      ['Personal', null],
      ['WhatsApp', 1],
      ['WhatsApp', 2],
      ['Page', null],
    ],
  );
  assert.equal(roster.totalRooms, 7);
  assert.equal(roster.accounts[0].rooms[0].name, 'Synthetic Personal Room One');
  assert.equal(roster.accounts[0].rooms[1].name, null);
  assert.throws(() => normalizeRoster({ roster: { accounts: [{ channel: 'Personal', accountRef: 'bad', rooms: [] }] } }));
});

test('HostClient issues GET-only reads and validates the room envelope', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).includes('/oss-roster')) return jsonResponse({ ok: true, roster: RAW_ROSTER.roster });
    return jsonResponse({ ok: true, text: 'YENRA_SOCIAL_V1:' + JSON.stringify({ accountRef: REF_A, roomRef: REF_B, messages: [] }) });
  };
  const client = new HostClient({ baseUrl: 'http://127.0.0.1:60474', fetchImpl });
  const roster = await client.readRoster({ refresh: true });
  assert.equal(roster.accounts.length, 4);
  await client.readRoom({ accountRef: REF_A, roomRef: REF_B, channel: 'WhatsApp' });
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.init.method, 'GET');
  assert.match(calls[0].url, /\/api\/yenra\/oss-roster\?refresh=1$/);
  assert.match(calls[1].url, /\/api\/yenra\/social-read\?mode=room&accountRef=/);

  const mismatch = new HostClient({
    baseUrl: 'http://127.0.0.1:60474',
    fetchImpl: async () => jsonResponse({ ok: true, text: 'YENRA_SOCIAL_V1:' + JSON.stringify({ accountRef: REF_A, roomRef: 'f'.repeat(32), messages: [] }) }),
  });
  await assert.rejects(
    () => mismatch.readRoom({ accountRef: REF_A, roomRef: REF_B, channel: 'WhatsApp' }),
    (error) => error.code === 'HOST_ROOM_SCOPE_MISMATCH',
  );
});

test('HostClient exposes no send/POST surface', () => {
  const client = new HostClient({ baseUrl: 'http://127.0.0.1:60474', fetchImpl: async () => jsonResponse({}) });
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
  assert.equal(methods.some((name) => /post|send|write/i.test(name)), false);
});

test('HostClient maps non-200 reads to a stable error code', async () => {
  const client = new HostClient({ baseUrl: 'http://127.0.0.1:60474', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(() => client.readRoster(), (error) => error.code === 'HOST_HTTP_503');
});

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value };
}

test('Page avatar separates confirmed no-photo 204 from native provider failure 503', async () => {
  const empty = new HostClient({
    baseUrl: 'http://127.0.0.1:60474',
    fetchImpl: async () => ({ ok:false, status:204 }),
  });
  assert.equal(await empty.readFacebookContactAvatar({accountRef:REF_A,roomRef:REF_B}),null);
  const failed = new HostClient({
    baseUrl: 'http://127.0.0.1:60474',
    fetchImpl: async () => ({ ok:false, status:503 }),
  });
  await assert.rejects(
    failed.readFacebookContactAvatar({accountRef:REF_A,roomRef:REF_B}),
    error=>error.code==='CONTACT_AVATAR_HOST_HTTP_503');
});
