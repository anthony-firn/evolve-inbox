// Build a public, dependency-free developer package from an explicit allowlist.
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(process.argv[2] || join(root, 'build'));
const stage = await mkdtemp(join(tmpdir(), 'evolve-inbox-sdk-'));
try {
  const files = ['src/client.mjs', 'src/client.d.mts', 'src/demo-client.mjs', 'src/demo-client.d.mts',
    'demo/messages.mjs', 'tools/inbox.mjs', 'docs/sdk-readme.md', 'LICENSE', 'NOTICE'];
  for (const name of files) {
    const dest = join(stage, name === 'docs/sdk-readme.md' ? 'README.md' : name);
    await mkdir(resolve(dest, '..'), { recursive: true }); await copyFile(join(root, name), dest);
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'evolve-inbox-client', version: '0.3.0',
    description: 'Fetch client and read-only CLI for Evolve Inbox, with offline fictional fixtures.', type: 'module', license: 'Apache-2.0',
    engines: { node: '>=22' }, bin: { 'evolve-inbox': './tools/inbox.mjs' },
    exports: { '.': { types: './src/client.d.mts', import: './src/client.mjs' },
      './demo': { types: './src/demo-client.d.mts', import: './src/demo-client.mjs' } },
    repository: 'https://github.com/anthony-firn/evolve-inbox' }, null, 2) + '\n');
  await mkdir(out, { recursive: true });
  const result = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: stage, encoding: 'utf8' }));
  console.log(JSON.stringify({ file: join(out, result[0].filename), files: result[0].files.map(f => f.path), integrity: result[0].integrity }));
} finally { await rm(stage, { recursive: true, force: true }); }
