// Evolve Inbox: receive Forward Email webhooks, store messages in Netlify Blobs, and read them at /mail.
// Server-only settings: MAIL_HOOK_SECRET and MAIL_PASSWORD. No credentials or real messages belong in this source.
import { getStore } from '@netlify/blobs';

const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body, status = 200) => Response.json(body, { status, headers: noStore });

/** Compares secrets without leaking how much of a guess was right. */
function same(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (!y.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const addresses = (field) => (field?.value ?? []).map((v) => (v.name ? `${v.name} <${v.address}>` : v.address)).join(', ') || field?.text || '';
const result = (check) => check?.status?.result ?? check?.result ?? (Array.isArray(check?.results) ? check.results[0]?.status?.result : undefined);
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

/** A receiving inbox with injectable storage for local tests. Secrets are read only on the server. */
export function createInbox({
  store = () => getStore({ name: 'mail', consistency: 'strong' }),
  setting = (name) => globalThis.Netlify?.env.get(name) ?? process.env[name] ?? '',
  label = 'Evolve Inbox',
} = {}) {
  async function receive(req) {
    const msg = await req.json();
    const id = `${Date.now().toString(36).padStart(9, '0')}-${crypto.randomUUID().slice(0, 8)}`;
    const item = {
      id,
      receivedAt: Date.now(),
      date: msg.date,
      from: addresses(msg.from),
      to: addresses(msg.to),
      cc: addresses(msg.cc),
      recipients: msg.recipients ?? [],
      replyTo: addresses(msg.replyTo),
      subject: msg.subject ?? '(no subject)',
      text: msg.text ?? '',
      html: typeof msg.html === 'string' ? msg.html : '',
      auth: { spf: result(msg.spf), dkim: result(msg.dkim), dmarc: result(msg.dmarc) },
      attachments: (msg.attachments ?? []).map((a) => ({
        filename: a.filename ?? 'attachment', contentType: a.contentType ?? 'application/octet-stream', size: a.size ?? 0,
        data: a.content?.data ? base64(a.content.data) : '',
      })),
    };
    const s = store();
    await s.setJSON(`msg/${id}`, item);
    const index = (await s.get('index', { type: 'json' })) ?? [];
    index.unshift({ id, receivedAt: item.receivedAt, from: item.from, to: item.recipients.join(', ') || item.to, subject: item.subject, preview: item.text.replace(/\s+/g, ' ').slice(0, 140), attachments: item.attachments.length, auth: item.auth });
    await s.setJSON('index', index.slice(0, 2000));
    return new Response('ok', { headers: noStore });
  }

  return async (req) => {
    const { pathname } = new URL(req.url);

    if (pathname.startsWith('/mail/hook/')) {
      if (req.method !== 'POST' || !same(pathname.slice('/mail/hook/'.length), setting('MAIL_HOOK_SECRET'))) return new Response('not found', { status: 404 });
      return receive(req);
    }

    if (pathname === '/mail' || pathname === '/mail/') {
      return new Response(renderPage({ label }), {
        headers: {
          ...noStore,
          'Content-Type': 'text/html; charset=utf-8',
          // Messages are untrusted: they're shown as text, or as HTML in a sandboxed frame that inherits this policy,
          // so remote images, trackers and scripts in an email never load.
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data: blob:; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    if (pathname.startsWith('/mail/api/')) {
      const password = setting('MAIL_PASSWORD');
      if (!same((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''), password)) return json({ error: 'wrong password' }, 401);
      const s = store();
      if (pathname === '/mail/api/messages' && req.method === 'GET') return json((await s.get('index', { type: 'json' })) ?? []);
      const one = /^\/mail\/api\/messages\/([a-z0-9-]{10,40})$/.exec(pathname);
      if (one && req.method === 'GET') {
        const item = await s.get(`msg/${one[1]}`, { type: 'json' });
        return item ? json(item) : json({ error: 'not found' }, 404);
      }
      if (one && req.method === 'DELETE') {
        await s.delete(`msg/${one[1]}`);
        const index = ((await s.get('index', { type: 'json' })) ?? []).filter((m) => m.id !== one[1]);
        await s.setJSON('index', index);
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    }
    return new Response('not found', { status: 404 });
  };

}

/** The live inbox and the static demonstration share the same reader UI. */
export function renderPage({ label = 'Evolve Inbox', demoMessages = null } = {}) {
  const safeLabel = String(label).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const asScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeLabel} · Inbox</title>
<style>
  :root { --bg: #fbf8f4; --surface: #fff; --text: #1d1915; --muted: #6f665d; --line: #e7dfd6; --accent: #d9480f; --good: #2b8a3e; --bad: #c92a2a; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14110f; --surface: #1d1916; --text: #f3ede7; --muted: #a99d91; --line: #342d27; --accent: #ff7a3d; --good: #69db7c; --bad: #ff8787; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 1; }
  h1 { font-size: 18px; margin: 0; }
  button, input { font: inherit; color: inherit; }
  button { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr); max-width: 1200px; margin: 0 auto; }
  @media (min-width: 900px) { .layout { grid-template-columns: 380px minmax(0, 1fr); } .list { border-right: 1px solid var(--line); height: calc(100dvh - 57px); overflow: auto; } .reader { height: calc(100dvh - 57px); overflow: auto; } }
  .item { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 12px 16px; background: none; }
  .item[aria-current="true"] { background: var(--surface); }
  .item strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { color: var(--muted); font-size: 13px; }
  .reader { padding: 16px; }
  .meta { display: grid; gap: 2px; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line); margin-right: 4px; }
  .badge.good { color: var(--good); } .badge.bad { color: var(--bad); }
  pre { white-space: pre-wrap; word-break: break-word; font: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  iframe { width: 100%; min-height: 70vh; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .demo-notice { margin: 0; padding: 10px 16px; text-align: center; color: var(--muted); background: var(--surface); border-bottom: 1px solid var(--line); font-size: 13px; }
  button:disabled { cursor: default; opacity: .6; }
  .login { max-width: 360px; margin: 18vh auto; padding: 16px; display: grid; gap: 12px; }
  @media (max-width: 899px) { body.reading .list { display: none; } body:not(.reading) .reader { display: none; } }
</style>
</head>
<body>
<div id="app"></div>
<script>
const app = document.getElementById('app');
const demoMessages = ${asScript(demoMessages)};
const mailboxLabel = ${asScript(label)};
let password = demoMessages ? '' : sessionStorage.getItem('mail-password') || '';
let messages = [];
let current = null;
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) n.append(k); return n; };
const when = (t) => new Date(t).toLocaleString();
const size = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

async function api(path, init = {}) {
  if (demoMessages) {
    if (init.method && init.method !== 'GET') throw new Error('This demonstration is read only.');
    if (path === 'messages') return structuredClone(demoMessages.map((m) => ({ ...m, attachments: m.attachments.length })));
    const message = demoMessages.find((m) => path === 'messages/' + m.id);
    if (!message) throw new Error('Message not found.');
    return structuredClone(message);
  }
  const res = await fetch('/mail/api/' + path, { ...init, headers: { Authorization: 'Bearer ' + password } });
  if (res.status === 401) { sessionStorage.removeItem('mail-password'); password = ''; login('That password didn’t work.'); throw new Error('unauthorized'); }
  return res.json();
}

function login(problem) {
  const input = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const form = el('form', { className: 'login' }, el('h1', { textContent: mailboxLabel + ' inbox' }), input, el('button', { className: 'primary', type: 'submit', textContent: 'Open inbox' }));
  if (problem) form.append(el('p', { className: 'muted', textContent: problem }));
  form.onsubmit = (e) => { e.preventDefault(); password = input.value; sessionStorage.setItem('mail-password', password); load(); };
  app.replaceChildren(form);
  input.focus();
}

function authBadges(auth) {
  return ['spf', 'dkim', 'dmarc'].map((k) => {
    const v = auth && auth[k];
    return el('span', { className: 'badge ' + (v === 'pass' ? 'good' : v ? 'bad' : ''), textContent: k.toUpperCase() + ' ' + (v || 'n/a'), title: 'Whether the sender’s domain vouches for this message' });
  });
}

async function open(id) {
  current = id;
  document.body.classList.add('reading');
  render();
  const m = await api('messages/' + id);
  const reader = document.querySelector('.reader');
  const body = el('div');
  const showText = () => body.replaceChildren(el('pre', { textContent: m.text || '(no text)' }));
  const showHtml = () => {
    // A sandboxed frame with no scripts; it inherits this page's policy, so remote images and trackers don't load.
    const frame = el('iframe', { sandbox: '', title: 'Message' });
    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;; img-src data: blob:;">' + m.html;
    body.replaceChildren(frame);
  };
  const toggles = el('div', { className: 'row' });
  if (m.html) toggles.append(el('button', { textContent: 'Formatted', onclick: showHtml }), el('button', { textContent: 'Plain text', onclick: showText }));
  const atts = el('div', { className: 'row' });
  for (const a of m.attachments || []) {
    const bytes = Uint8Array.from(atob(a.data || ''), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: a.contentType }));
    atts.append(el('a', { href: url, download: a.filename, textContent: '📎 ' + a.filename + ' (' + size(a.size || bytes.length) + ')' }));
  }
  reader.replaceChildren(
    el('div', { className: 'row' },
      el('button', { textContent: '← Inbox', onclick: () => { current = null; document.body.classList.remove('reading'); render(); } }),
      el('button', { textContent: 'Delete', disabled: !!demoMessages, title: demoMessages ? 'Read-only demonstration' : '', onclick: async () => { if (!confirm('Delete this message?')) return; await api('messages/' + id, { method: 'DELETE' }); current = null; document.body.classList.remove('reading'); load(); } })),
    el('h2', { textContent: m.subject }),
    el('div', { className: 'meta' },
      el('span', { textContent: 'From: ' + m.from }),
      el('span', { textContent: 'To: ' + ((m.recipients && m.recipients.join(', ')) || m.to) }),
      m.cc ? el('span', { textContent: 'Cc: ' + m.cc }) : '',
      el('span', { className: 'muted', textContent: when(m.receivedAt) }),
      el('div', {}, ...authBadges(m.auth))),
    atts, toggles, body);
  m.html ? showHtml() : showText();
}

function render() {
  const list = el('div', { className: 'list' });
  if (!messages.length) list.append(el('p', { className: 'muted', style: 'padding:16px', textContent: 'No mail yet. Anything sent to any address at evolvetech.dev shows up here.' }));
  for (const m of messages) {
    list.append(el('button', { className: 'item', onclick: () => open(m.id), ariaCurrent: String(m.id === current) },
      el('strong', { textContent: m.subject }),
      el('span', { className: 'muted', textContent: m.from + ' → ' + m.to }), el('br'),
      el('span', { className: 'muted', textContent: when(m.receivedAt) + (m.attachments ? ' · 📎' + m.attachments : '') }), el('br'),
      el('span', { className: 'muted', textContent: m.preview })));
  }
  const reader = document.querySelector('.reader') || el('div', { className: 'reader' });
  const header = el('header', {}, el('h1', { textContent: (demoMessages ? 'Evolve Inbox · Demo' : mailboxLabel + ' inbox') + ' (' + messages.length + ')' }),
    el('div', { className: 'row' }, el('button', { textContent: 'Refresh', onclick: load }),
      el('button', { textContent: demoMessages ? 'Read-only demo' : 'Lock', disabled: !!demoMessages, onclick: () => { sessionStorage.removeItem('mail-password'); password = ''; login(); } })));
  app.replaceChildren(header, ...(demoMessages ? [el('p', { className: 'demo-notice', textContent: 'Fictional messages for this public demo. No connection to the EvolveTech mailbox.' })] : []), el('div', { className: 'layout' }, list, reader));
}

async function load() {
  if (!password && !demoMessages) return login();
  try { messages = await api('messages'); render(); if (demoMessages && !current && messages.length) await open(messages[0].id); } catch (e) { if (e.message !== 'unauthorized') app.prepend(el('p', { className: 'muted', textContent: 'Couldn’t load: ' + e.message })); }
}

load();
setInterval(() => { if (password && !current) load(); }, 30000);
</script>
</body>
</html>`;
}
