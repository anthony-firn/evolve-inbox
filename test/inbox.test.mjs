import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInbox, renderPage } from '../src/inbox.mjs';

function fixture(settings = { MAIL_PASSWORD: 'test-password', MAIL_HOOK_SECRET: 'test-hook-secret' }, customize = (store) => store) {
  const data = new Map();
  const versions = new Map();
  let revision = 0;
  const storage = customize({
    get: async (k) => structuredClone(data.get(k)),
    getWithMetadata: async (k) => data.has(k) ? { data: structuredClone(data.get(k)), etag: versions.get(k) } : null,
    setJSON: async (k, v, options = {}) => {
      if ((options.onlyIfNew && data.has(k)) || (options.onlyIfMatch && versions.get(k) !== options.onlyIfMatch)) return { modified: false };
      const etag = String(++revision);
      data.set(k, structuredClone(v));
      versions.set(k, etag);
      return { modified: true, etag };
    },
    delete: async (k) => { data.delete(k); versions.delete(k); },
  });
  const handle = createInbox({ store: () => storage, setting: (k) => settings[k] || '', label: 'Example' });
  const request = (path, { method = 'GET', body, password = 'test-password' } = {}) => handle(new Request('https://example.com/mail' + path, {
    method, headers: { Authorization: 'Bearer ' + password, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  return { data, handle, request, storage };
}

test('inbox metadata and message contents require the password', async () => {
  const { request } = fixture();
  for (const path of ['/api/messages', '/api/messages/1234567890-abcd']) {
    assert.equal((await request(path, { password: '' })).status, 401);
    assert.equal((await request(path, { password: 'wrong-password' })).status, 401);
  }
  assert.deepEqual(await (await request('/api/messages')).json(), []);
});

test('a missing configuration never authorizes empty credentials or a webhook', async () => {
  const { request } = fixture({});
  assert.equal((await request('/api/messages', { password: '' })).status, 401);
  assert.equal((await request('/hook/', { method: 'POST', body: {} })).status, 404);
});

test('only the configured webhook accepts inbound mail', async () => {
  const { request, data } = fixture();
  assert.equal((await request('/hook/wrong', { method: 'POST', body: {} })).status, 404);
  assert.equal((await request('/hook/test-hook-secret')).status, 404);
  assert.equal(data.size, 0);
});

test('an inbound message retains its text, HTML, attachment and reported sender checks', async () => {
  const { request } = fixture();
  const inbound = {
    from: { value: [{ name: 'Alex', address: 'alex@example.org' }] }, to: { value: [{ address: 'hello@example.com' }] },
    recipients: ['hello@example.com'], subject: '<script>untrusted subject</script>', text: 'Hello from the test.', html: '<p>Hello</p>',
    spf: { status: { result: 'pass' } }, dkim: { result: 'pass' }, dmarc: { result: 'pass' },
    attachments: [{ filename: 'notes.txt', contentType: 'text/plain', size: 5, content: { data: [104, 101, 108, 108, 111] } }],
  };
  assert.equal((await request('/hook/test-hook-secret', { method: 'POST', body: inbound })).status, 200);
  const listing = await (await request('/api/messages')).json();
  assert.equal(listing.length, 1);
  assert.equal(listing[0].from, 'Alex <alex@example.org>');
  assert.equal(listing[0].subject, inbound.subject);
  assert.equal('html' in listing[0], false);
  const message = await (await request('/api/messages/' + listing[0].id)).json();
  assert.equal(message.text, inbound.text);
  assert.equal(message.html, inbound.html);
  assert.deepEqual(message.auth, { spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  assert.equal(Buffer.from(message.attachments[0].data, 'base64').toString(), 'hello');
});

test('deletion needs authentication and removes only the selected message', async () => {
  const { request } = fixture();
  for (const subject of ['One', 'Two']) await request('/hook/test-hook-secret', { method: 'POST', body: { subject } });
  const listing = await (await request('/api/messages')).json();
  const path = '/api/messages/' + listing[0].id;
  assert.equal((await request(path, { method: 'DELETE', password: 'wrong' })).status, 401);
  assert.equal((await request(path, { method: 'DELETE' })).status, 200);
  assert.equal((await request(path)).status, 404);
  assert.equal((await (await request('/api/messages')).json()).length, 1);
});

test('the live reader sends restrictive headers and never embeds credentials or messages', async () => {
  const { request } = fixture();
  const page = await request('');
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.match(page.headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
  const text = await page.text();
  assert.ok(!text.includes('test-password'));
  assert.ok(!text.includes('test-hook-secret'));
  assert.match(text, /const demoMessages = null/);
  assert.match(text, /sandbox: ''/);
});

test('demo data cannot break out of its script and live labels cannot inject HTML', () => {
  const page = renderPage({ label: '</title><script>alert(1)</script>', demoMessages: [{ text: '</script><script>alert(1)</script>' }] });
  assert.equal((page.match(/<script>/g) || []).length, 1);
  assert.ok(page.includes('&lt;/title&gt;'));
  assert.ok(page.includes('\\u003c/script>'));
});

test('simultaneous deliveries and deletion preserve unrelated inbox entries', async () => {
  const { request } = fixture();
  await request('/hook/test-hook-secret', { method: 'POST', body: { subject: 'Delete me' } });
  const [first] = await (await request('/api/messages')).json();
  const responses = await Promise.all([
    request('/api/messages/' + first.id, { method: 'DELETE' }),
    ...Array.from({ length: 24 }, (_, i) => request('/hook/test-hook-secret', { method: 'POST', body: { subject: 'Concurrent ' + i } })),
  ]);
  responses.forEach((response) => assert.equal(response.status, 200));
  const listing = await (await request('/api/messages')).json();
  assert.equal(listing.length, 24);
  assert.equal(new Set(listing.map((m) => m.id)).size, 24);
  assert.ok(!listing.some((m) => m.id === first.id));
  for (const m of listing) assert.equal((await request('/api/messages/' + m.id)).status, 200);
});

test('simultaneous webhook retries are idempotent and retain the first receipt', async () => {
  const { request, data } = fixture();
  const inbound = { messageId: '<retry@example.org>', recipients: ['hello@example.com'], subject: 'Retry', text: 'Hello' };
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('/hook/test-hook-secret', { method: 'POST', body: inbound })));
  responses.forEach((response) => assert.equal(response.status, 200));
  const [first] = await (await request('/api/messages')).json();
  await request('/hook/test-hook-secret', { method: 'POST', body: { ...inbound, spf: { result: 'pass' } } });
  const listing = await (await request('/api/messages')).json();
  assert.equal(listing.length, 1);
  assert.equal(listing[0].receivedAt, first.receivedAt);
  assert.equal([...data.keys()].filter((key) => key.startsWith('msg/')).length, 1);
});

test('reused Message-IDs with different recipients or content remain distinct', async () => {
  const { request } = fixture();
  for (const body of [
    { messageId: '<reused@example.org>', recipients: ['one@example.com'], text: 'One' },
    { messageId: '<reused@example.org>', recipients: ['two@example.com'], text: 'One' },
    { messageId: '<reused@example.org>', recipients: ['one@example.com'], text: 'Two' },
  ]) assert.equal((await request('/hook/test-hook-secret', { method: 'POST', body })).status, 200);
  assert.equal((await (await request('/api/messages')).json()).length, 3);
});

test('a retried delivery repairs an interrupted index write', async () => {
  let failIndex = true;
  const { request, data } = fixture(undefined, (store) => {
    const set = store.setJSON;
    store.setJSON = async (key, ...args) => {
      if (key === 'index' && failIndex) { failIndex = false; throw new Error('unavailable; private storage details'); }
      return set(key, ...args);
    };
    return store;
  });
  const inbound = { messageId: '<partial@example.org>', subject: 'Retry after outage' };
  const failed = await request('/hook/test-hook-secret', { method: 'POST', body: inbound });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Retry-After'), '5');
  assert.ok(!(await failed.text()).includes('private storage'));
  const original = [...data.values()].find((value) => value.subject === inbound.subject);
  assert.equal((await request('/hook/test-hook-secret', { method: 'POST', body: inbound })).status, 200);
  const listing = await (await request('/api/messages')).json();
  assert.equal(listing.length, 1);
  assert.equal(listing[0].receivedAt, original.receivedAt);
});

test('unconfirmed conditional writes and storage read failures return retryable errors', async () => {
  const { request } = fixture(undefined, (store) => ({ ...store, setJSON: async () => ({ modified: true, etag: '' }), get: async () => { throw new Error('private storage error'); } }));
  assert.equal((await request('/hook/test-hook-secret', { method: 'POST', body: { subject: 'Not stored' } })).status, 503);
  const response = await request('/api/messages');
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private storage'));
});

test('an index without a storage version is never overwritten unconditionally', async () => {
  let attemptedIndexWrite = false;
  const { request } = fixture(undefined, (store) => {
    const set = store.setJSON;
    return { ...store, getWithMetadata: async () => ({ data: [{ id: 'legacy-message-01' }], etag: undefined }),
      setJSON: async (key, ...args) => { if (key === 'index') attemptedIndexWrite = true; return set(key, ...args); } };
  });
  assert.equal((await request('/hook/test-hook-secret', { method: 'POST', body: { subject: 'Unsafe index' } })).status, 503);
  assert.equal(attemptedIndexWrite, false);
});

test('malformed and oversized webhook payloads are rejected without storing messages', async () => {
  const { handle, request, data } = fixture();
  for (const body of [null, [], { text: {} }, { recipients: 'one@example.com' }, { attachments: {} }, { attachments: [null] }, { attachments: [{ content: { data: [256] } }] }]) {
    const response = await handle(new Request('https://example.com/mail/hook/test-hook-secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
  }
  const invalid = await handle(new Request('https://example.com/mail/hook/test-hook-secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
  assert.equal(invalid.status, 400);
  const raw = await handle(new Request('https://example.com/mail/hook/test-hook-secret', { method: 'POST', body: 'raw MIME' }));
  assert.equal(raw.status, 415);
  assert.equal((await request('/hook/test-hook-secret', { method: 'POST', body: { text: 'x'.repeat(5_000_001) } })).status, 413);
  assert.equal(data.size, 0);
});

test('base64 attachments and mailparser false HTML are supported', async () => {
  const { request } = fixture();
  const response = await request('/hook/test-hook-secret', { method: 'POST', body: { html: false, attachments: [{ filename: 'test.txt', content: 'aGVsbG8=', size: 999 }] } });
  assert.equal(response.status, 200);
  const [first] = await (await request('/api/messages')).json();
  const message = await (await request('/api/messages/' + first.id)).json();
  assert.equal(message.html, '');
  assert.equal(message.attachments[0].size, 5);
  assert.equal(message.attachments[0].data, 'aGVsbG8=');
});

test('existing stored messages and the legacy index remain readable', async () => {
  const { storage, request } = fixture();
  const legacy = { id: '123456789-abcd1234', subject: 'Existing mail', receivedAt: 1 };
  await storage.setJSON('msg/' + legacy.id, legacy);
  await storage.setJSON('index', [legacy]);
  await request('/hook/test-hook-secret', { method: 'POST', body: { subject: 'New mail' } });
  assert.equal((await (await request('/api/messages')).json()).length, 2);
  assert.deepEqual(await (await request('/api/messages/' + legacy.id)).json(), legacy);
});

test('status is authenticated, reports readiness and never exposes secrets', async () => {
  const { request } = fixture({ MAIL_PASSWORD: 'test-password', MAIL_HOOK_SECRET: 'test-hook-secret', MAIL_LABEL: 'Acme Mail', MAIL_DOMAIN: 'example.com' });
  assert.equal((await request('/api/status', { password: '' })).status, 401);
  const response = await request('/api/status');
  const status = await response.json();
  assert.deepEqual(status, { ready: true, storage: 'ok', inboundConfigured: true, label: 'Acme Mail', domain: 'example.com', messageCount: 0, latestReceivedAt: null });
  assert.ok(!JSON.stringify(status).includes('test-password'));
  assert.ok(!JSON.stringify(status).includes('test-hook-secret'));
  const unready = fixture({ MAIL_PASSWORD: 'test-password' });
  assert.equal((await (await unready.request('/api/status')).json()).ready, false);
  const sharedSecret = fixture({ MAIL_PASSWORD: 'test-password', MAIL_HOOK_SECRET: 'test-password' });
  assert.equal((await (await sharedSecret.request('/api/status')).json()).ready, false);
  const page = await (await request('')).text();
  assert.ok(page.includes('Acme Mail'));
  assert.ok(!page.includes('any address at evolvetech.dev'));
});
