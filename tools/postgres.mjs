#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { openPostgres } from '../src/postgres-store.mjs';

const command = process.argv[2];
let pool;
try {
  if (!['migrate', 'export', 'import'].includes(command) || process.argv.length !== 3) throw new Error('Invalid command');
  const connection = await openPostgres(); pool = connection.pool;
  const { store } = connection;
  if (command === 'migrate') { await store.migrate(); console.log(JSON.stringify({ ok: true, schema: 1 })); }
  else {
    const file = process.env.MAIL_EXPORT_FILE;
    if (!file) throw new Error('Missing backup path');
    if (command === 'export') {
      const messages = await store.exportMessages();
      await writeFile(file, JSON.stringify({ format: 'evolve-inbox.messages.v1', messages }), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ ok: true, exported: messages.length }));
    } else {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.format !== 'evolve-inbox.messages.v1') throw new Error('Invalid backup format');
      console.log(JSON.stringify({ ok: true, ...await store.importMessages(data.messages) }));
    }
  }
} catch {
  console.error(JSON.stringify({ ok: false, error: 'PostgreSQL operation failed. Check command, connection, schema and backup file. No credentials or message contents are logged.' }));
  process.exitCode = 1;
} finally { await pool?.end(); }
