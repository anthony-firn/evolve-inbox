import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { createInbox } from '../src/inbox.mjs';
import { createPostgresStore } from '../src/postgres-store.mjs';
import { reserveAuthentication } from '../src/security.mjs';

// Separate from npm test: requires a disposable PostgreSQL database, never a live inbox.
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to a disposable test database');
const schema = 'test_inbox_' + randomBytes(8).toString('hex');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
await admin.query('CREATE SCHEMA '+schema);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 12, options: '-c search_path='+schema });
pool.on('error', () => {});
const store = createPostgresStore(pool);
const item = (id, receivedAt = 1) => ({ id: `mail-${id.padStart(12, '0')}`, receivedAt, from: 'sender@example.org', to: 'owner@example.org',
  recipients: ['owner@example.org'], subject: id, text: 'Fictional test message', html: '', attachments: [], auth: {} });

await test('PostgreSQL storage contract against a real database', async (t) => {
  t.after(async () => { await pool.end(); await admin.query('DROP SCHEMA '+schema+' CASCADE'); await admin.end(); });
  await store.migrate();
  await store.migrate();
  await t.test('concurrent deliveries keep independent rows; duplicate retries preserve the first receipt', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, n) => store.receiveMessage(item('parallel'+n, n))));
    const original = item('same-delivery', 10);
    await store.receiveMessage(original);
    await Promise.all(Array.from({ length: 30 }, (_, n) => store.receiveMessage({ ...original, receivedAt: 100+n })));
    assert.equal((await store.get('index')).length, 41);
    assert.deepEqual(await store.get('msg/'+original.id), original);
    const list = await store.get('index');
    assert.equal(list.filter((x) => x.id === original.id).length, 1);
    assert.equal(list.find((x) => x.id === original.id).receivedAt, 10);
  });
  await t.test('a SQL constraint failure rolls back the whole import, including preceding successful inserts', async () => {
    await pool.query(`ALTER TABLE evolve_inbox_messages ADD CONSTRAINT integration_reject_subject CHECK(subject <> 'reject-in-database')`);
    const first = item('rollback-first'), second = { ...item('rollback-second'), subject: 'reject-in-database' };
    await assert.rejects(store.importMessages([first, second]), { code: '23514' });
    assert.equal(await store.get('msg/'+first.id), null);
    assert.ok(!(await store.get('index')).some((r) => r.id === first.id));
    await pool.query('ALTER TABLE evolve_inbox_messages DROP CONSTRAINT integration_reject_subject');
  });
  await t.test('terminating a connection before commit leaves no partial import', async () => {
    const client = await pool.connect(); client.on('error', () => {});
    let signalWritten, resume;
    const written = new Promise((r) => { signalWritten = r; });
    const paused = new Promise((r) => { resume = r; });
    const interrupted = createPostgresStore({ connect: async () => ({
      query: async (...args) => { const result = await client.query(...args); if (String(args[0]).startsWith('INSERT INTO evolve_inbox_messages')) { signalWritten(); await paused; } return result; },
      release: (error) => client.release(error),
    }) });
    const record = item('terminated-import');
    const importing = interrupted.importMessages([record]);
    const rejected = assert.rejects(importing);
    await written;
    await pool.query('SELECT pg_terminate_backend($1)', [client.processID]);
    resume(); await rejected;
    assert.equal(await store.get('msg/'+record.id), null);
  });
  await t.test('versioned authentication writes reject stale release and share the failure budget', async () => {
    const key = 'security/auth/test/slot';
    const first = await store.setJSON(key, { until: 2000 }, { onlyIfNew: true });
    const next = await store.setJSON(key, { until: 3000 }, { onlyIfMatch: first.etag });
    assert.ok(next.modified);
    assert.equal((await store.setJSON(key, { until: 0 }, { onlyIfMatch: first.etag })).modified, false);
    const reservations = await Promise.all(Array.from({ length: 30 }, () => reserveAuthentication(store, { ip: '192.0.2.8' }, 'fictional-secret', 1000)));
    assert.equal(reservations.filter((r) => r.release).length, 20);
    assert.equal(reservations.filter((r) => r.retryAfter).length, 10);
  });
  await t.test('the real handler can receive, list, read and delete using the adapter', async () => {
    const settings = { MAIL_PASSWORD: 'fictional-reader-password', MAIL_HOOK_SECRET: 'fictional-webhook-secret' };
    const handle = createInbox({ store: () => store, setting: (k) => settings[k] || '', audit: () => {} });
    const request = (path, init={}) => handle(new Request('https://example.org/mail'+path, {
      headers: { Authorization: 'Bearer '+settings.MAIL_PASSWORD, 'Content-Type': 'application/json' }, ...init,
    }), { ip: '192.0.2.22' });
    const body = JSON.stringify({ messageId: '<handler@example.org>', recipients: ['owner@example.org'], subject: 'Handler fixture', text: 'Fictional' });
    assert.equal((await request('/hook/'+settings.MAIL_HOOK_SECRET, { method: 'POST', body })).status, 200);
    const list = await (await request('/api/messages')).json();
    const message = list.find((r) => r.subject === 'Handler fixture'); assert.ok(message);
    assert.equal((await (await request('/api/messages/'+message.id)).json()).text, 'Fictional');
    assert.equal((await request('/api/messages/'+message.id, { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/messages/'+message.id)).status, 404);
    assert.ok(!(await store.get('index')).some((r) => r.id === message.id));
  });
  await t.test('backup/restore includes old messages beyond the reader limit and does not overwrite duplicates', async () => {
    await store.importMessages(Array.from({ length: 2010 }, (_, n) => item('backup'+n, n)));
    const backup = await store.exportMessages();
    assert.ok(backup.length > 2000); assert.equal((await store.get('index')).length, 2000);
    await pool.query('TRUNCATE evolve_inbox_messages');
    assert.equal((await store.importMessages(backup)).imported, backup.length);
    assert.deepEqual(await store.importMessages(backup), { imported: 0, existing: backup.length });
    assert.deepEqual(await store.exportMessages(), backup);
  });
});
