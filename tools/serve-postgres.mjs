#!/usr/bin/env node
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createInbox } from '../src/inbox.mjs';
import { openPostgres } from '../src/postgres-store.mjs';
import { same } from '../src/security.mjs';

let pool;
try {
  const password = process.env.MAIL_PASSWORD || '', hook = process.env.MAIL_HOOK_SECRET || '';
  if (password.length < 20 || hook.length < 20 || same(password, hook)) throw new Error('Independent long secrets required');
  const port = Number(process.env.MAIL_HTTP_PORT || 4195);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const connection = await openPostgres(); pool = connection.pool;
  // Refuse an unmigrated/unavailable database before accepting requests.
  await connection.store.get('index');
  const handle = createInbox({ store: () => connection.store });
  const server = createServer({ requestTimeout: 20000, headersTimeout: 10000 }, async (req, res) => {
    try {
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
      const request = new Request(new URL(req.url, 'http://localhost'), { method: req.method, headers: req.headers,
        ...(body ? { body, duplex: 'half' } : {}) });
      // Do not trust caller-controlled X-Forwarded-For. Reverse-proxy clients share its socket budget.
      const result = await handle(request, { ip: req.socket.remoteAddress });
      res.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) Readable.fromWeb(result.body).pipe(res); else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"error":"Inbox unavailable. Please retry."}');
    }
  });
  server.on('error', () => { console.error('Inbox listener failed'); process.exitCode = 1; pool.end(); });
  server.listen(port, process.env.MAIL_HTTP_HOST || '127.0.0.1', () => console.log(`Evolve Inbox listening on port ${port}; use HTTPS at the reverse proxy.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { pool.end(); }));
} catch {
  console.error('Inbox startup failed. Check database, migration, independent secrets and listen settings.');
  await pool?.end(); process.exitCode = 1;
}
