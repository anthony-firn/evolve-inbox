import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInbox } from '../src/inbox.mjs';
import { AUTH_SLOTS, AUTH_WINDOW_MS, credential, reserveAuthentication } from '../src/security.mjs';

function memory() {
  const data = new Map(); let revision = 0;
  return { data, get: async (key) => data.get(key)?.data,
    getWithMetadata: async (key) => structuredClone(data.get(key) ?? null),
    setJSON: async (key, value, condition = {}) => {
      const current = data.get(key);
      if (condition.onlyIfNew && current || condition.onlyIfMatch && condition.onlyIfMatch !== current?.etag) return { modified: false };
      const etag = String(++revision); data.set(key, { data: structuredClone(value), etag });
      return { modified: true, etag };
    },
  };
}
const secrets = { MAIL_PASSWORD: 'reader-private', MAIL_HOOK_SECRET: 'hook-private' };
const request = (password = 'wrong') => new Request('https://example.com/mail/api/messages', { headers: { Authorization: 'Bearer ' + password } });
const ip = { ip: '192.0.2.45' };

test('parallel handler instances share a strict failed-attempt budget and recover after expiry', async () => {
  const store = memory(); let clock = 1_800_000_000_000;
  const options = { store: () => store, setting: (name) => secrets[name] || '', now: () => clock, audit: () => {} };
  const handlers = [createInbox(options), createInbox(options)];
  const responses = await Promise.all(Array.from({ length: AUTH_SLOTS + 8 }, (_, i) => handlers[i % 2](request(), ip)));
  assert.equal(responses.filter((r) => r.status === 401).length, AUTH_SLOTS);
  assert.equal(responses.filter((r) => r.status === 429).length, 8);
  const blocked = await handlers[0](request(secrets.MAIL_PASSWORD), ip);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
  clock += AUTH_WINDOW_MS;
  assert.equal((await handlers[1](request(secrets.MAIL_PASSWORD), ip)).status, 200);
  assert.equal(store.data.size, AUTH_SLOTS);
});

test('successful authentication releases its slot; request headers cannot spoof the platform IP', async () => {
  const store = memory();
  const handle = createInbox({ store: () => store, setting: (name) => secrets[name] || '', audit: () => {} });
  for (let i = 0; i < AUTH_SLOTS + 5; i++) assert.equal((await handle(request(secrets.MAIL_PASSWORD), ip)).status, 200);
  for (let i = 0; i < AUTH_SLOTS; i++) {
    const req = request(); req.headers.set('X-Forwarded-For', `192.0.2.${i}`);
    assert.equal((await handle(req, ip)).status, 401);
  }
  assert.equal((await handle(request(), ip)).status, 429);
  // Valid inbound delivery remains independent of reader lockout.
  const delivery = new Request('https://example.com/mail/hook/' + secrets.MAIL_HOOK_SECRET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  // This minimal store cannot maintain an inbox index; authorization gets past 404.
  assert.notEqual((await handle(delivery, ip)).status, 404);
});

test('authentication fails closed on missing versions, unconfirmed writes and storage errors', async () => {
  for (const broken of [
    { getWithMetadata: async () => { throw new Error('secret backend details'); } },
    { getWithMetadata: async () => ({ data: { until: 0 } }) },
    { getWithMetadata: async () => null, setJSON: async () => ({ modified: true }) },
  ]) {
    const handle = createInbox({ store: () => broken, setting: (name) => secrets[name] || '', audit: () => {} });
    const response = await handle(request(secrets.MAIL_PASSWORD), ip);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret backend/);
  }
});

test('a delayed release cannot erase a replacement reservation', async () => {
  const store = memory(); const clock = 1_800_000_000_000;
  const first = await reserveAuthentication(store, ip, 'salt', clock);
  await reserveAuthentication(store, ip, 'salt', clock + AUTH_WINDOW_MS);
  const before = structuredClone([...store.data]);
  await first.release();
  assert.deepEqual([...store.data], before);
});

test('previous credentials require an explicit bounded deadline, independent roles and a current credential', async () => {
  const clock = Date.parse('2026-11-03T12:00:00Z');
  const settings = { ...secrets, MAIL_PASSWORD_PREVIOUS: 'old-reader', MAIL_PASSWORD_PREVIOUS_UNTIL: '2026-11-03T13:00:00Z' };
  const check = () => credential('old-reader', 'MAIL_PASSWORD', (name) => settings[name] || '', clock);
  assert.equal(check(), 'previous');
  assert.equal(credential(secrets.MAIL_PASSWORD, 'MAIL_PASSWORD', (name) => settings[name] || '', clock), 'current');
  for (const until of ['', 'invalid', '2026-11-03T12:00:00Z', '2026-11-05T12:00:00Z']) {
    settings.MAIL_PASSWORD_PREVIOUS_UNTIL = until; assert.equal(check(), null);
  }
  settings.MAIL_PASSWORD_PREVIOUS_UNTIL = '2026-11-03T13:00:00Z';
  settings.MAIL_HOOK_SECRET_PREVIOUS = 'old-reader'; assert.equal(check(), null);
  delete settings.MAIL_HOOK_SECRET_PREVIOUS;
  settings.MAIL_PASSWORD = ''; assert.equal(check(), null);
});

test('reader and inbound accept previous secrets only during rotation; audit events exclude private data', async () => {
  const store = memory(); const events = []; let clock = Date.parse('2026-11-03T12:00:00Z');
  const settings = { ...secrets, MAIL_PASSWORD_PREVIOUS: 'old-reader', MAIL_HOOK_SECRET_PREVIOUS: 'old-hook',
    MAIL_PASSWORD_PREVIOUS_UNTIL: '2026-11-03T13:00:00Z', MAIL_HOOK_SECRET_PREVIOUS_UNTIL: '2026-11-03T13:00:00Z' };
  const handle = createInbox({ store: () => store, setting: (name) => settings[name] || '', now: () => clock, audit: (event) => events.push(event) });
  assert.equal((await handle(request('old-reader'), ip)).status, 200);
  const inbound = () => new Request('https://example.com/mail/hook/old-hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'private subject', text: 'private contents', from: 'private@example.org' }) });
  assert.equal((await handle(inbound(), ip)).status, 200);
  assert.equal(events.filter((e) => e.event === 'previous_credential_used').length, 2);
  await handle(request('private-wrong-password'), ip);
  const serialized = JSON.stringify(events);
  for (const value of [...Object.values(settings), ip.ip, 'private subject', 'private contents', 'private@example.org', 'private-wrong-password', '/mail/hook/']) assert.ok(!serialized.includes(value));
  assert.deepEqual(Object.keys(events[0]).sort(), ['at', 'event', 'schema', 'surface']);
  clock = Date.parse('2026-11-03T13:00:00Z');
  assert.equal((await handle(request('old-reader'), ip)).status, 401);
  assert.equal((await handle(inbound(), ip)).status, 404);
});

test('audit sink failures do not interrupt authenticated access', async () => {
  const store = memory(); const handle = createInbox({ store: () => store, setting: (name) => secrets[name] || '', audit: () => { throw Error('logging offline'); } });
  assert.equal((await handle(request(), ip)).status, 401);
  assert.equal((await handle(request(secrets.MAIL_PASSWORD), ip)).status, 200);
});
