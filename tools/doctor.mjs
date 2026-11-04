import { parseArgs } from 'node:util';
import { loadEnvFile } from 'node:process';
import { Resolver } from 'node:dns/promises';
import { diagnose } from '../src/setup.mjs';

const { values } = parseArgs({ options: { json: { type: 'boolean' } } });
try { loadEnvFile(); }
catch (error) {
  if (error.code !== 'ENOENT') {
    const message = 'Could not read .env. Check its format and file permissions.';
    if (values.json) console.log(JSON.stringify({ ok: false, error: message })); else console.error(message);
    process.exit(1);
  }
}
const resolver = new Resolver({ timeout: 3000, tries: 2 });
const checks = await diagnose(process.env, { resolveMx: (domain) => resolver.resolveMx(domain), resolveTxt: (domain) => resolver.resolveTxt(domain) });
if (values.json) console.log(JSON.stringify({ schema: 'evolve-inbox.doctor.v1', ok: checks.every((check) => check.ok), checks, smtpDeliveryVerified: false }));
else {
  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`);
  console.log('Checks are read only. Send a real message from another account to verify SMTP delivery.');
}
if (checks.some((check) => !check.ok)) process.exitCode = 1;
