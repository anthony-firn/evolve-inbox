import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSetup, diagnose, normalizeDomain, normalizeSite } from '../src/setup.mjs';

const run = promisify(execFile);
const setupScript = fileURLToPath(new URL('../tools/setup.mjs', import.meta.url));
const options = { domain: 'example.com', site: 'https://example.netlify.app', label: "Morgan's #1 Inbox" };

test('setup creates independent secrets, valid dotenv and specific private forwarding instructions', () => {
  const setup = createSetup(options);
  assert.deepEqual(parseEnv(setup.env), setup.settings);
  assert.match(setup.settings.MAIL_PASSWORD, /^[a-f0-9]{64}$/);
  assert.notEqual(setup.settings.MAIL_PASSWORD, setup.settings.MAIL_HOOK_SECRET);
  assert.ok(setup.guide.includes('forward-email=hello:https://example.netlify.app/mail/hook/' + setup.settings.MAIL_HOOK_SECRET + '?raw=false'));
  assert.ok(setup.guide.includes('encrypt the COMPLETE rule'));
  assert.ok(!setup.guide.includes(setup.settings.MAIL_PASSWORD));
  assert.ok(createSetup({ ...options, alias: '*' }).guide.includes('forward-email=/^(.*?)$/:https://'));
});

test('setup validates domains, production origins, labels and aliases', () => {
  assert.equal(normalizeDomain(' EXAMPLE.COM '), 'example.com');
  assert.equal(normalizeSite('https://example.netlify.app/'), options.site);
  for (const domain of ['', 'hello@example.com', 'https://example.com', 'example.com/path', 'example..com', '-bad.example', 'example.com\nTXT=bad']) assert.throws(() => normalizeDomain(domain));
  for (const site of ['', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/mail', 'https://example.com?hook=secret', 'https://example.com/#fragment']) assert.throws(() => normalizeSite(site));
  assert.throws(() => createSetup({ ...options, label: 'bad\nMAIL_PASSWORD=override' }));
  assert.throws(() => createSetup({ ...options, alias: 'hello:other@example.org' }));
});

test('setup CLI uses private file permissions, avoids secret output and refuses overwrites', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'inbox-setup-'));
  try {
    const args = [setupScript, '--domain', options.domain, '--site', options.site];
    const { stdout, stderr } = await run(process.execPath, args, { cwd });
    const env = await readFile(join(cwd, '.env'), 'utf8');
    const settings = parseEnv(env);
    for (const secret of [settings.MAIL_PASSWORD, settings.MAIL_HOOK_SECRET]) assert.ok(!(stdout + stderr).includes(secret));
    for (const name of ['.env', '.mail-setup.md']) assert.equal((await stat(join(cwd, name))).mode & 0o777, 0o600);
    await assert.rejects(run(process.execPath, args, { cwd }), (error) => error.code === 1 && error.stderr.includes('will not overwrite'));
    assert.equal(await readFile(join(cwd, '.env'), 'utf8'), env);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('setup rolls back new files if a private guide already exists', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'inbox-setup-'));
  try {
    await writeFile(join(cwd, '.mail-setup.md'), 'existing guide');
    await assert.rejects(run(process.execPath, [setupScript, '--domain', options.domain, '--site', options.site], { cwd }));
    await assert.rejects(stat(join(cwd, '.env')), { code: 'ENOENT' });
    assert.equal(await readFile(join(cwd, '.mail-setup.md'), 'utf8'), 'existing guide');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

function diagnostics(settings, overrides = {}) {
  const requests = [];
  const dependencies = {
    resolveMx: async () => [{ exchange: 'mx1.forwardemail.net' }, { exchange: 'mx2.forwardemail.net.' }],
    resolveTxt: async () => [['forward-email-site-verification=example']],
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      return url.endsWith('/status') ? Response.json({ ready: true, storage: 'ok', domain: settings.MAIL_DOMAIN, messageCount: 0, latestReceivedAt: null }) : Response.json({ error: 'wrong password' }, { status: 401 });
    }, ...overrides,
  };
  return { requests, checks: diagnose(settings, dependencies) };
}

test('doctor checks DNS and authenticated status using only read-only requests', async () => {
  const { settings } = createSetup(options);
  const { requests, checks } = diagnostics(settings);
  assert.ok((await checks).every((check) => check.ok));
  assert.equal(requests.length, 2);
  assert.ok(!requests[0].headers);
  assert.equal(requests[1].headers.Authorization, 'Bearer ' + settings.MAIL_PASSWORD);
  assert.ok(requests.every((request) => request.redirect === 'manual' && !request.method));
});

test('doctor catches competing MX, exposed TXT secrets, unavailable auth and domain mismatch without printing secrets', async () => {
  const { settings } = createSetup(options);
  const { checks } = diagnostics(settings, {
    resolveMx: async () => [{ exchange: 'mx1.forwardemail.net' }, { exchange: 'mx2.forwardemail.net' }, { exchange: 'old-provider.example.org' }],
    resolveTxt: async () => [['forward-email=hello:https://example.netlify.app/mail/', 'hook/' + settings.MAIL_HOOK_SECRET]],
    fetch: async (url) => url.endsWith('/status') ? Response.json({ ready: false, storage: 'ok', domain: 'wrong.example.org' }) : new Response('', { status: 200 }),
  });
  const result = await checks;
  assert.equal(result.filter((check) => !check.ok).length, 5);
  assert.ok(!JSON.stringify(result).includes(settings.MAIL_HOOK_SECRET));
  assert.ok(!JSON.stringify(result).includes(settings.MAIL_PASSWORD));
});

test('doctor handles network and DNS errors without exposing response bodies', async () => {
  const { settings } = createSetup(options);
  const { checks } = diagnostics(settings, {
    resolveMx: async () => { throw new Error('private DNS details'); },
    resolveTxt: async () => { throw Object.assign(new Error('private DNS details'), { code: 'ENODATA' }); },
    fetch: async () => { throw new Error('private connection details'); },
  });
  const result = await checks;
  assert.equal(result.filter((check) => !check.ok).length, 3);
  assert.ok(!JSON.stringify(result).includes('private DNS details'));
  assert.ok(!JSON.stringify(result).includes('private connection details'));
});
