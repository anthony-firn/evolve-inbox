import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInbox, renderPage } from '../src/inbox.mjs';

function fixture(settings = { MAIL_PASSWORD: 'test-password', MAIL_HOOK_SECRET: 'test-hook-secret' }) {
  const data = new Map();
  const storage = { get: async (k) => structuredClone(data.get(k)), setJSON: async (k, v) => data.set(k, structuredClone(v)), delete: async (k) => data.delete(k) };
  const handle = createInbox({ store: () => storage, setting: (k) => settings[k] || '', label: 'Example' });
  const request = (path, { method = 'GET', body, password = 'test-password' } = {}) => handle(new Request('https://example.com/mail' + path, {
    method, headers: { Authorization: 'Bearer ' + password, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  return { data, handle, request };
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
