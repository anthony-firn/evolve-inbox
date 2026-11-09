import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createDemoClient } from '../src/demo-client.mjs';

test('offline fixtures use the live client contract and refuse mutation', async () => {
  const saved = globalThis.fetch; globalThis.fetch = () => { throw Error('Unexpected network'); };
  try {
    const client = createDemoClient(); const list = await client.list();
    assert.equal(list.length, 3); assert.equal((await client.status()).storage, 'fixture');
    assert.equal((await client.get(list[0].id)).subject, list[0].subject);
    await assert.rejects(client.delete(list[0].id), e => e.status === 403);
    await assert.rejects(client.get('demo-missing-001'), e => e.code === 'not_found');
    assert.equal((await client.list()).length, 3);
  } finally { globalThis.fetch = saved; }
});
test('CLI keeps credentials out of errors and accepts no destructive or credential arguments', () => {
  const output = spawnSync(process.execPath, ['tools/inbox.mjs', '--demo', 'list'], { encoding: 'utf8' });
  assert.equal(output.status, 0); assert.equal(JSON.parse(output.stdout).data.length, 3);
  for (const args of [['--password', 'DO-NOT-LEAK'], ['--demo', 'delete', 'demo-welcome-001'], ['get', '../DO-NOT-LEAK']]) {
    const r = spawnSync(process.execPath, ['tools/inbox.mjs', ...args], { encoding: 'utf8', env: { ...process.env, MAIL_PASSWORD: 'DO-NOT-LEAK' } });
    assert.equal(r.status, 1); assert(!r.stderr.includes('DO-NOT-LEAK')); assert.equal(JSON.parse(r.stderr).ok, false);
  }
});
test('packed allowlist installs offline and runs from a clean consumer directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inbox-consumer-'));
  try {
    const packed = JSON.parse(execFileSync(process.execPath, ['tools/pack-sdk.mjs', root], { encoding: 'utf8' }));
    assert(packed.files.includes('src/client.d.mts')); assert(packed.files.includes('tools/inbox.mjs'));
    assert(!packed.files.some(p => /\.env|security\.mjs|incoming\.mjs|mail-store/.test(p)));
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packed.file], { cwd: root, stdio: 'pipe' });
    const script = "import {createDemoClient} from 'evolve-inbox-client/demo'; console.log((await createDemoClient().list()).length)";
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' }).trim(), '3');
    const result = execFileSync(process.execPath, ['node_modules/evolve-inbox-client/tools/inbox.mjs', '--demo', 'get', 'demo-welcome-001'], { cwd: root, encoding: 'utf8' });
    assert.equal(JSON.parse(result).data.id, 'demo-welcome-001');
    const manifest = JSON.parse(await readFile(join(root, 'node_modules/evolve-inbox-client/package.json')));
    assert.equal(manifest.version, '0.3.0'); assert(!manifest.dependencies);
  } finally { await rm(root, { recursive: true, force: true }); }
});
