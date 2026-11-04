import { loadEnvFile } from 'node:process';
import { open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

// Stage only. Never changes Netlify, DNS, routing or the active local .env.
try {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) console.log('node tools/rotate.mjs [--json]\nWrites a private .env.rotation with new reader/webhook secrets and a 1-hour grace deadline. See docs/security.md before importing.');
  else {
    try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!process.env.MAIL_PASSWORD || !process.env.MAIL_HOOK_SECRET || process.env.MAIL_PASSWORD === process.env.MAIL_HOOK_SECRET) throw new Error('configuration');
    const until = new Date(Date.now() + 3600000).toISOString();
    const settings = {};
    for (const key of ['MAIL_LABEL', 'MAIL_DOMAIN', 'MAIL_SITE_URL']) if (process.env[key]) settings[key] = process.env[key];
    for (const name of ['MAIL_PASSWORD', 'MAIL_HOOK_SECRET']) {
      settings[name] = randomBytes(32).toString('hex');
      settings[name + '_PREVIOUS'] = process.env[name];
      settings[name + '_PREVIOUS_UNTIL'] = until;
    }
    const file = await open('.env.rotation', 'wx', 0o600);
    try { await file.writeFile('# Private staged rotation; not deployed. Never commit.\n' + Object.entries(settings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n'); }
    finally { await file.close(); }
    console.log(values.json ? JSON.stringify({ ok: true, schema: 'evolve-inbox.rotation.v1', file: '.env.rotation', previousUntil: until, deployed: false }) : 'Created private .env.rotation; nothing deployed. Follow docs/security.md before importing.');
  }
} catch {
  const result = { ok: false, error: 'Rotation was not staged. Check independent current credentials and file permissions; existing .env.rotation is never overwritten.' };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result)); else console.error(result.error);
  process.exitCode = 1;
}
