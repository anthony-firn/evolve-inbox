import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const publicRoot = new URL('../public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/assets/inbox.css', ['assets/inbox.css', 'text/css']],
  ['/assets/inbox.js', ['assets/inbox.js', 'text/javascript']],
]);
const server = createServer(async (req, res) => {
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
  assert.deepEqual(outbound, [], 'mail HTML cannot load remote content');
  assert.deepEqual(errors, [], 'the demo has no browser errors');
  console.log('Demo browser checks passed: reader, plain text, attachment, sender badges, read-only controls, HTML isolation and mobile layout.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
