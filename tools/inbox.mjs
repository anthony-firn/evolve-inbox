#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createClient, InboxError } from '../src/client.mjs';
import { createDemoClient } from '../src/demo-client.mjs';

const usage = `Usage: evolve-inbox [--demo] status|list|get [message-id]

All results are JSON. --demo uses fictional, read-only fixtures without a network.
Live access requires MAIL_SITE (HTTPS origin) and MAIL_PASSWORD in the environment.
Credentials are never accepted in arguments. This CLI has no delete command.
Live list/get output contains private mail; choose where you save it.`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { demo: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) console.log(usage);
  else {
    const [command = 'status', id] = positionals;
    if (!['status', 'list', 'get'].includes(command) || positionals.length > (command === 'get' ? 2 : 1) || (command === 'get' && !id))
      throw new TypeError('Use status, list, or get with a message ID.');
    const client = values.demo ? createDemoClient() : createClient({ site: process.env.MAIL_SITE, password: process.env.MAIL_PASSWORD });
    const data = await (command === 'get' ? client.get(id) : client[command]());
    console.log(JSON.stringify({ ok: true, mode: values.demo ? 'fixture' : 'live', data }));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof InboxError ? {
    code: error.code, status: error.status, retryAfter: error.retryAfter, message: error.message,
  } : { code: 'invalid_arguments', message: 'Check the command, message ID, MAIL_SITE and MAIL_PASSWORD. Use --help for usage.' } }));
  process.exitCode = 1;
}
