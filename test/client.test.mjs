import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient, InboxError } from '../src/client.mjs';

test('client uses headers, rejects redirects and makes exactly one request per operation', async () => {
  const calls = [];
  const client = createClient({ site: 'https://example.com', password: 'private-token', fetch: async (...args) => {
    calls.push(args); return Response.json([]);
  } });
  await client.list(); await client.get('1234567890'); await client.delete('1234567890'); await client.status();
  assert.deepEqual(calls.map(([url, options]) => [url, options.method]), [
    ['https://example.com/mail/api/messages', 'GET'], ['https://example.com/mail/api/messages/1234567890', 'GET'],
    ['https://example.com/mail/api/messages/1234567890', 'DELETE'], ['https://example.com/mail/api/status', 'GET'],
  ]);
  for (const [url, options] of calls) {
    assert.ok(!url.includes('private-token')); assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
  }
  for (const id of ['../status', 'id?password=private-token', 'short']) assert.throws(() => client.get(id), TypeError);
});

test('typed errors expose status and retry delay without leaking server bodies or retrying deletion', async () => {
  for (const [status, code] of [[401, 'unauthorized'], [429, 'throttled'], [404, 'not_found'], [503, 'unavailable']]) {
    let calls = 0;
    const client = createClient({ site: 'https://example.com', password: 'private-token', fetch: async () => {
      calls++; return new Response('private response body', { status, headers: { 'Retry-After': '60' } });
    } });
    await assert.rejects(client.delete('1234567890'), (error) => error instanceof InboxError && error.code === code && error.status === status && error.retryAfter === 60 && !JSON.stringify(error).includes('private'));
    assert.equal(calls, 1);
  }
});

test('network, malformed JSON and cancellation failures have safe error codes', async () => {
  for (const [fetch, code] of [
    [async () => { throw Error('private transport details'); }, 'network'],
    [async () => new Response('not JSON'), 'invalid_response'],
  ]) {
    const client = createClient({ site: 'https://example.com', password: 'private-token', fetch });
    await assert.rejects(client.list(), (error) => error.code === code && !error.message.includes('private'));
  }
  const controller = new AbortController(); controller.abort();
  const client = createClient({ site: 'https://example.com', password: 'private-token', fetch: async (_, options) => { options.signal.throwIfAborted(); } });
  await assert.rejects(client.list({ signal: controller.signal }), (error) => error.code === 'aborted');
  for (const site of ['http://example.com', 'https://user:password@example.com', 'https://example.com/redirect', 'https://example.com?token=private']) assert.throws(() => createClient({ site, password: 'x' }));
});
