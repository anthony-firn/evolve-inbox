import { open, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createSetup } from '../src/setup.mjs';

const usage = `Usage: npm run setup -- --domain example.com --site https://your-inbox.netlify.app [--label "My Inbox"] [--alias hello]

Without arguments, an interactive terminal prompts for the domain and site URL.
Creates private .env and .mail-setup.md files; refuses to overwrite existing files.
Use --alias '*' only if you want to receive mail for the whole domain.`;

try {
  const { values } = parseArgs({ options: { domain: { type: 'string' }, site: { type: 'string' }, label: { type: 'string' }, alias: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) console.log(usage);
  else {
    if (!values.domain || !values.site) {
      if (!process.stdin.isTTY) throw new Error(usage);
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        values.domain ||= await input.question('Mail domain (example.com): ');
        values.site ||= await input.question('Netlify production URL (https://your-inbox.netlify.app): ');
      } finally { input.close(); }
    }
    const setup = createSetup(values);
    const created = [];
    try {
      for (const [path, content] of [['.env', setup.env], ['.mail-setup.md', setup.guide]]) {
        const file = await open(path, 'wx', 0o600);
        created.push(path);
        try { await file.writeFile(content); } finally { await file.close(); }
      }
    } catch (error) {
      await Promise.all(created.map((path) => unlink(path)));
      if (error.code === 'EEXIST') throw new Error('Setup files already exist. Edit them directly; setup will not overwrite settings or rotate your secrets.');
      throw error;
    }
    console.log('Created private .env and .mail-setup.md files. Secrets were not printed.\nOpen .mail-setup.md for your deployment and forwarding instructions, then run npm run doctor.');
  }
} catch (error) {
  console.error(error.code ? 'Could not create setup files. Check arguments, file permissions and existing .env / .mail-setup.md files.' : error.message);
  process.exitCode = 1;
}
