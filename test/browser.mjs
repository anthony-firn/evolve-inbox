import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createInbox } from '../src/inbox.mjs';
import { messages } from '../demo/messages.mjs';

// Fictional fixtures only; browser tests exercise the real authenticated handler.
const mailData = new Map([
  ['index', messages.map((message) => ({ ...message, attachments: message.attachments.length }))],
  ...messages.map((message) => ['msg/' + message.id, structuredClone(message)]),
]);
let storageRevision = 0;
const mailVersions = new Map([...mailData.keys()].map((key) => [key, String(++storageRevision)]));
const inbox = createInbox({
  setting: (key) => ({ MAIL_PASSWORD: 'browser-test-password', MAIL_HOOK_SECRET: 'browser-test-hook', MAIL_DOMAIN: 'example.com', MAIL_LABEL: 'Example Mail' })[key] || '',
  store: () => ({
    get: async (key) => structuredClone(mailData.get(key)),
    getWithMetadata: async (key) => mailData.has(key) ? { data: structuredClone(mailData.get(key)), etag: mailVersions.get(key) } : null,
    setJSON: async (key, value, options = {}) => {
      if ((options.onlyIfNew && mailData.has(key)) || (options.onlyIfMatch && mailVersions.get(key) !== options.onlyIfMatch)) return { modified: false };
      const etag = String(++storageRevision);
      mailData.set(key, structuredClone(value));
      mailVersions.set(key, etag);
      return { modified: true, etag };
    },
    delete: async (key) => { mailData.delete(key); mailVersions.delete(key); },
  }),
});

const publicRoot = new URL('../public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/assets/inbox.css', ['assets/inbox.css', 'text/css']],
  ['/assets/inbox.js', ['assets/inbox.js', 'text/javascript']],
]);
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/mail')) {
    const response = await inbox(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const file = files.get(req.url);
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file[1], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'none'" });
  res.end(await readFile(new URL(file[0], publicRoot)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', timezoneId: 'America/Tijuana' });
  const outbound = [];
  await context.route('**/*', (route) => {
    if (!route.request().url().startsWith(url)) { outbound.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText('Fictional messages for this public demo.', { exact: false }).waitFor();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Your new inbox is ready.' }).waitFor();
  assert.ok(!(await page.locator('.list').innerText()).includes('[object Object]'));
  assert.ok(!(await page.getByRole('button', { name: /Your new inbox is ready/ }).innerText()).includes('📎'));
  assert.ok((await page.getByRole('button', { name: /Notes from our project review/ }).innerText()).includes('📎1'));
  assert.equal(await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, type: 'jpeg', quality: 88 });
  await page.getByRole('button', { name: 'Plain text', exact: true }).click();
  assert.match(await page.locator('.reader pre').innerText(), /Hi Morgan/);
  await page.getByRole('button', { name: /Notes from our project review/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: /project-notes.txt/ }).click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'project-notes.txt');
  assert.match(await readFile(await download.path(), 'utf8'), /Demo project notes/);
  await page.getByRole('button', { name: /A message with a failed sender check/ }).click();
  assert.ok(await page.locator('.reader .badge.bad').count() > 0);
  await page.evaluate(() => { demoMessages[0].html += '<img src="https://example.org/tracker.gif"><script>parent.__mailExecuted = true;</script>'; });
  await page.getByRole('button', { name: /Your new inbox is ready/ }).click();
  await page.frameLocator('iframe').getByRole('heading', { name: 'Your new inbox is ready.' }).waitFor();
  assert.equal(await page.evaluate(() => window.__mailExecuted), undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.list').isVisible(), false);
  await page.getByRole('button', { name: '← Inbox', exact: true }).click();
  assert.equal(await page.locator('.list').isVisible(), true);
  await page.getByRole('searchbox', { name: 'Search mail' }).fill('sam project');
  assert.equal(await page.locator('.message-list .item').count(), 1);
  await page.getByRole('searchbox', { name: 'Search mail' }).fill('no such message');
  await page.getByText('No messages match your search.').waitFor();
  await page.getByRole('searchbox', { name: 'Search mail' }).fill('');
  await page.getByRole('checkbox', { name: 'Has attachments' }).check();
  assert.equal(await page.locator('.message-list .item').count(), 1);
  await page.getByRole('checkbox', { name: 'Has attachments' }).uncheck();
  assert.equal(await page.locator('.message-list .item').count(), 3);
  assert.deepEqual(outbound, [], 'mail HTML cannot load remote content');
  assert.deepEqual(errors, [], 'the demo has no browser errors');
  await page.close();

  const live = await context.newPage();
  live.on('pageerror', (error) => errors.push(error.message));
  await live.goto(url + 'mail');
  await live.getByRole('textbox', { name: 'Inbox password' }).fill('wrong-password');
  await live.getByRole('button', { name: 'Open inbox', exact: true }).click();
  await live.getByText('That password didn’t work.').waitFor();
  await live.getByRole('textbox', { name: 'Inbox password' }).fill('browser-test-password');
  await live.getByRole('button', { name: 'Open inbox', exact: true }).click();
  await live.getByRole('heading', { name: 'Example Mail inbox (3)', exact: true }).waitFor();
  await live.getByRole('button', { name: 'Setup status', exact: true }).click();
  await live.getByText('Storage is available and an independent webhook secret is configured.', { exact: false }).waitFor();
  await live.setViewportSize({ width: 1280, height: 800 });

  // Force the first message response to arrive after the second selection.
  let resolveDelayed;
  const delayed = new Promise((resolve) => { resolveDelayed = resolve; });
  await live.route('**/mail/api/messages/demo-welcome-001', (route) => resolveDelayed(route), { times: 1 });
  await live.getByRole('button', { name: /Your new inbox is ready/ }).click();
  const delayedRoute = await delayed;
  await live.getByRole('button', { name: /Notes from our project review/ }).click();
  await live.locator('.reader').getByRole('heading', { name: 'Notes from our project review', exact: true }).waitFor();
  await delayedRoute.fulfill({ json: messages[0] });
  await live.getByRole('button', { name: '← Inbox', exact: true }).click();
  await live.getByRole('button', { name: 'Refresh', exact: true }).click();
  await live.getByRole('heading', { name: 'Example Mail inbox (3)', exact: true }).waitFor();
  assert.equal(await live.locator('.reader h2').count(), 0, 'late message responses do not reopen a closed reader');

  await live.route('**/mail/api/messages/demo-checks-003', (route) => route.fulfill({ status: 503, json: { error: 'Storage is temporarily unavailable.' } }), { times: 1 });
  await live.getByRole('button', { name: /A message with a failed sender check/ }).click();
  await live.getByText('Couldn’t open this message.', { exact: true }).waitFor();
  await live.getByText('Storage is temporarily unavailable.', { exact: true }).waitFor();
  await live.getByRole('button', { name: 'Try again', exact: true }).click();
  await live.locator('.reader').getByRole('heading', { name: 'A message with a failed sender check', exact: true }).waitFor();

  live.on('dialog', (dialog) => dialog.accept());
  await live.route('**/mail/api/messages/demo-checks-003', (route) => route.fulfill({ status: 503, json: { error: 'Delete failed; please retry.' } }), { times: 1 });
  await live.getByRole('button', { name: 'Delete', exact: true }).click();
  await live.getByText('Delete failed; please retry.', { exact: true }).waitFor();
  await live.getByRole('button', { name: 'Delete', exact: true }).click();
  await live.getByRole('heading', { name: 'Example Mail inbox (2)', exact: true }).waitFor();

  await live.getByRole('button', { name: 'Lock', exact: true }).click();
  await live.getByRole('button', { name: 'Open inbox', exact: true }).waitFor();
  assert.equal(await live.evaluate(() => sessionStorage.getItem('mail-password')), null);
  assert.equal(await live.locator('.reader').count(), 0);
  assert.equal(await live.evaluate(() => document.body.classList.contains('reading')), false);
  assert.deepEqual(errors, [], 'authenticated reader handles failures without unhandled browser errors');
  assert.deepEqual(outbound, [], 'browser checks make no external requests');
  console.log('Browser checks passed: demo, search, attachments, mobile layout, HTML isolation, authentication, setup status, late responses, retry, delete and lock.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
