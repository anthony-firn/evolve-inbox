const app = document.getElementById('app');
const demoMessages = [{"id":"demo-welcome-001","receivedAt":1792926000000,"from":"Alex \u003calex@example.org>","to":"hello@example.com","recipients":["hello@example.com"],"subject":"Your new inbox is ready","preview":"One place for mail sent to your own domain.","text":"Hi Morgan,\n\nYour new inbox is ready. Mail sent to your domain arrives here through an inbound webhook.\n\nOpen a message, check the sender authentication results, download an attachment, or switch to plain text.\n\nThese are fictional messages in a read-only demonstration.\n\nAlex","html":"\u003cdiv style=\"font-family:system-ui;color:#29231e;padding:24px\">\u003cp style=\"color:#d9480f;font-size:13px\">EVOLVE INBOX\u003c/p>\u003ch1>Your new inbox is ready.\u003c/h1>\u003cp>Hi Morgan,\u003c/p>\u003cp>One place for mail sent to your own domain, with a reader that stays out of the way.\u003c/p>\u003cul>\u003cli>Read formatted mail or plain text.\u003c/li>\u003cli>Download attachments.\u003c/li>\u003cli>Inspect the sender’s reported SPF, DKIM and DMARC results.\u003c/li>\u003c/ul>\u003cp>These messages are fictional. The demo cannot read or change the EvolveTech mailbox.\u003c/p>\u003cp>Alex\u003c/p>\u003c/div>","auth":{"spf":"pass","dkim":"pass","dmarc":"pass"},"attachments":[]},{"id":"demo-notes-0002","receivedAt":1792918800000,"from":"Sam \u003csam@example.net>","to":"projects@example.com","recipients":["projects@example.com"],"subject":"Notes from our project review","preview":"The deployment notes are attached as a text file.","text":"Hi Morgan,\n\nThe deployment notes are attached as a text file.\n\nEverything in this demo uses reserved example domains. No real email or passwords are included.\n\nSam","html":"","auth":{"spf":"pass","dkim":"pass","dmarc":"pass"},"attachments":[{"filename":"project-notes.txt","contentType":"text/plain","size":74,"data":"RGVtbyBwcm9qZWN0IG5vdGVzCgpDb25maWd1cmUgeW91ciBkb21haW4sIHdlYmhvb2sgYW5kIHByaXZhdGUgaW5ib3ggcGFzc3dvcmQuCg=="}]},{"id":"demo-checks-003","receivedAt":1792911600000,"from":"Sender \u003csender@example.org>","to":"hello@example.com","recipients":["hello@example.com"],"subject":"A message with a failed sender check","preview":"Authentication badges show what the forwarding provider reported.","text":"This fictional message demonstrates a failed sender check. The badges report the forwarding provider’s authentication results; the inbox does not compute these results itself.","html":"","auth":{"spf":"fail","dkim":"none","dmarc":"fail"},"attachments":[]}];
const mailboxLabel = "Evolve Inbox";
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
