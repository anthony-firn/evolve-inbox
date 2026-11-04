import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tool = (name, args, cwd, extraEnv = {}) => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MAIL_')) delete env[key];
  const result = spawnSync(process.execPath, [new URL(`../tools/${name}.mjs`, import.meta.url).pathname, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  return { ...result, output: JSON.parse(result.stdout) };
};

test('setup JSON creates private files, omits secrets and refuses to replace an existing configuration', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'inbox-setup-'));
  try {
    const args = ['--domain', 'example.com', '--site', 'https://example.com', '--json'];
    const result = tool('setup', args, cwd); assert.equal(result.status, 0); assert.equal(result.output.ok, true);
    const env = await readFile(join(cwd, '.env'), 'utf8');
    const password = /MAIL_PASSWORD="([^"]+)"/.exec(env)[1];
    assert.ok(!result.stdout.includes(password));
    assert.equal((await stat(join(cwd, '.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(cwd, '.mail-setup.md'))).mode & 0o777, 0o600);
    const second = tool('setup', args, cwd); assert.equal(second.status, 1); assert.equal(second.output.ok, false);
    assert.equal(await readFile(join(cwd, '.env'), 'utf8'), env);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('rotation JSON stages private, distinct credentials without changing active settings', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'inbox-rotate-'));
  try {
    const active = 'MAIL_PASSWORD="private-reader"\nMAIL_HOOK_SECRET="private-hook"\n';
    await writeFile(join(cwd, '.env'), active, { mode: 0o600 });
    const result = tool('rotate', ['--json'], cwd); assert.equal(result.status, 0);
    assert.equal(result.output.deployed, false);
    const staged = await readFile(join(cwd, '.env.rotation'), 'utf8');
    assert.match(staged, /MAIL_PASSWORD_PREVIOUS="private-reader"/);
    assert.match(staged, /MAIL_HOOK_SECRET_PREVIOUS="private-hook"/);
    assert.match(staged, /MAIL_PASSWORD="[a-f0-9]{64}"/);
    assert.ok(!result.stdout.includes('private-reader')); assert.ok(!result.stdout.includes('private-hook'));
    assert.equal((await stat(join(cwd, '.env.rotation'))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(cwd, '.env'), 'utf8'), active);
    assert.equal(tool('rotate', ['--json'], cwd).status, 1);
    assert.equal(await readFile(join(cwd, '.env.rotation'), 'utf8'), staged);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('doctor emits one JSON document on invalid configuration without touching mail or echoing credentials', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'inbox-doctor-'));
  try {
    const result = tool('doctor', ['--json'], cwd, { MAIL_PASSWORD: 'private-reader', MAIL_HOOK_SECRET: 'private-hook' });
    assert.equal(result.status, 1); assert.equal(result.output.ok, false);
    assert.equal(result.output.smtpDeliveryVerified, false);
    assert.ok(!result.stdout.includes('private-reader')); assert.ok(!result.stdout.includes('private-hook'));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
