import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';

export function normalizeDomain(value = '') {
  if (/[\s/@:#?\\]/.test(value.trim())) throw new Error('Enter a domain such as example.com, without an email address or URL.');
  const domain = domainToASCII(value.trim().toLowerCase());
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
    throw new Error('Enter a domain such as example.com, without an email address or URL.');
  }
  return domain;
}

export function normalizeSite(value = '') {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter the full HTTPS site URL, such as https://your-inbox.netlify.app.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The site must be an HTTPS origin without a path, credentials, query or fragment.');
  }
  return url.origin;
}

/** Generate private, copyable settings without making any remote changes. */
export function createSetup({ domain, site, label = 'My Inbox', alias = 'hello' }) {
  domain = normalizeDomain(domain);
  site = normalizeSite(site);
  label = label.trim();
  if (!label || label.length > 80 || /[\x00-\x1f\x7f"\\]/.test(label)) throw new Error('Use a mailbox label of 1–80 characters without control characters, double quotes or backslashes.');
  if (alias !== '*' && !/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(alias)) throw new Error('Use a simple alias such as hello, or * for a catch-all.');
  const settings = {
    MAIL_PASSWORD: randomBytes(32).toString('hex'), MAIL_HOOK_SECRET: randomBytes(32).toString('hex'),
    MAIL_LABEL: label, MAIL_DOMAIN: domain, MAIL_SITE_URL: site,
  };
  const webhook = `${site}/mail/hook/${settings.MAIL_HOOK_SECRET}?raw=false`;
  const rule = `forward-email=${alias === '*' ? '/^(.*?)$/' : alias}:${webhook}`;
  return {
    settings,
    env: '# Private Evolve Inbox settings. Import into Netlify; never commit or share.\n' + Object.entries(settings).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n',
    guide: `# Private setup for ${domain}

This file contains your inbound webhook secret. Keep it private along with .env.
Your reader password is MAIL_PASSWORD in .env; save it in your password manager.

1. Fork the repository and connect the fork to your own Netlify project. Use its stable production URL, ${site}.
2. Import .env in Netlify's environment settings with the Functions scope enabled. Restrict the secrets to the production context. If using the Netlify CLI, link the correct project before running netlify env:import .env, then review scopes and deploy contexts in the dashboard. Redeploy after saving.
3. Open ${site}/mail and unlock it with MAIL_PASSWORD from .env. Opening / shows the fictional demo.
4. Add ${domain} to your Forward Email account. Start with ${alias === '*' ? 'a catch-all alias' : `the alias ${alias}@${domain}`} and use this private webhook destination:

\`\`\`text
${webhook}
\`\`\`

Use Forward Email's private alias dashboard when available. For DNS-based routing, encrypt the COMPLETE rule below at https://forwardemail.net/en/encrypt before publishing the encrypted result in a TXT record at the domain root. Never publish this plaintext rule:

\`\`\`text
${rule}
\`\`\`

5. Review existing mail routing before changing MX records. When ready to route inbound mail through Forward Email, the root MX records are:

| Type | Host | Priority | Value |
| --- | --- | --- | --- |
| MX | @ | 10 | mx1.forwardemail.net |
| MX | @ | 10 | mx2.forwardemail.net |

6. Run npm run doctor to check your local settings, public DNS and the deployed API. It makes read-only checks and does not prove SMTP delivery.
7. Send a message from another account to ${alias === '*' ? 'hello' : alias}@${domain}. Verify the text, formatted view, attachments and sender checks at ${site}/mail. Run the doctor again to see the latest receipt time.

This project receives mail. For sending or replying, configure an outbound provider separately; see docs/setup.md. Do not replace existing SPF, DKIM or DMARC records just to enable this inbound inbox.

Provider setup: https://forwardemail.net/en/faq#do-you-support-webhooks
Troubleshooting: docs/setup.md
`,
  };
}

/** Read-only checks; dependencies are injectable so tests never use real mail or DNS. */
export async function diagnose(settings, { resolveMx, resolveTxt, fetch: request = fetch }) {
  const checks = [];
  const add = (ok, message) => checks.push({ ok, message });
  let domain, site;
  try { domain = normalizeDomain(settings.MAIL_DOMAIN); add(true, 'Mail domain is valid.'); }
  catch (error) { add(false, error.message); }
  try { site = normalizeSite(settings.MAIL_SITE_URL); add(true, 'Site URL is valid.'); }
  catch (error) { add(false, error.message); }
  const hasSecrets = !!settings.MAIL_PASSWORD && !!settings.MAIL_HOOK_SECRET && settings.MAIL_PASSWORD !== settings.MAIL_HOOK_SECRET;
  add(hasSecrets, hasSecrets ? 'Reader and webhook use separate secrets.' : 'Set different, nonempty MAIL_PASSWORD and MAIL_HOOK_SECRET values.');
  if (domain) {
    try {
      const mx = await resolveMx(domain);
      const hosts = mx.map((r) => r.exchange.toLowerCase().replace(/\.$/, ''));
      const expected = ['mx1.forwardemail.net', 'mx2.forwardemail.net'];
      const matches = expected.every((host) => hosts.includes(host)) && hosts.every((host) => expected.includes(host));
      add(matches, matches ? 'Both Forward Email MX hosts are present, with no competing MX hosts.' : 'MX records do not exclusively use both Forward Email hosts. Review existing routing before changing DNS.');
    } catch { add(false, 'Could not resolve MX records. Check the domain and DNS propagation.'); }
    try {
      const records = (await resolveTxt(domain)).map((parts) => parts.join(''));
      const exposed = records.some((record) => [settings.MAIL_PASSWORD, settings.MAIL_HOOK_SECRET].some((secret) => secret && record.includes(secret)) || /\/mail\/hook\//i.test(record));
      add(!exposed, exposed ? 'A mail secret or plaintext webhook is public in DNS. Remove it, rotate exposed secrets and use an encrypted rule or private alias.' : 'No plaintext inbox secret or webhook found in root TXT records. Verify the alias in Forward Email.');
    } catch (error) { add(error.code === 'ENODATA', error.code === 'ENODATA' ? 'No root TXT records; configure routing in the private alias dashboard.' : 'Could not inspect TXT records. Check DNS and retry.'); }
  }
  if (site) {
    const get = (path, headers) => request(site + '/mail/api/' + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    try {
      const response = await get('messages');
      add(response.status === 401, response.status === 401 ? 'The inbox API rejects requests without a password.' : 'The inbox API did not return 401 without a password. Check the deployment and routing.');
    } catch { add(false, 'Could not reach the deployed inbox API. Check MAIL_SITE_URL and deploy the function.'); }
    if (hasSecrets) {
      try {
        const response = await get('status', { Authorization: 'Bearer ' + settings.MAIL_PASSWORD });
        if (!response.ok) add(false, response.status === 401 ? 'The deployed reader password differs from .env. Review Netlify settings and redeploy.' : 'The deployed status check failed. Review the deployment and storage settings.');
        else {
          const status = await response.json();
          add(status.ready === true && status.storage === 'ok', status.ready === true && status.storage === 'ok' ? 'Authenticated API can read storage; an independent webhook secret is configured.' : 'Storage or the independent inbound webhook secret is not ready. Review Netlify settings and redeploy.');
          add(status.domain === domain, status.domain === domain ? 'The deployed mail domain matches .env.' : 'Deployed MAIL_DOMAIN differs from .env. Review Netlify settings and redeploy.');
          if (Number.isFinite(status.messageCount)) add(true, `${status.messageCount} messages listed. ${status.latestReceivedAt ? 'Latest receipt: ' + new Date(status.latestReceivedAt).toISOString() + '.' : 'No mail received yet; send a real message from another account.'}`);
        }
      } catch { add(false, 'Could not read deployment status. Check the deployed version, password and storage.'); }
    }
  }
  return checks;
}
