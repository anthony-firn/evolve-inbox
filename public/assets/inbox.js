const app = document.getElementById('app');
const demoMessages = [{"id":"demo-welcome-001","receivedAt":1792926000000,"from":"Alex \u003calex@example.org>","to":"hello@example.com","recipients":["hello@example.com"],"subject":"Your new inbox is ready","preview":"One place for mail sent to your own domain.","text":"Hi Morgan,\n\nYour new inbox is ready. Mail sent to your domain arrives here through an inbound webhook.\n\nOpen a message, check the sender authentication results, download an attachment, or switch to plain text.\n\nThese are fictional messages in a read-only demonstration.\n\nAlex","html":"\u003cdiv style=\"font-family:system-ui;color:#29231e;padding:24px\">\u003cp style=\"color:#d9480f;font-size:13px\">EVOLVE INBOX\u003c/p>\u003ch1>Your new inbox is ready.\u003c/h1>\u003cp>Hi Morgan,\u003c/p>\u003cp>One place for mail sent to your own domain, with a reader that stays out of the way.\u003c/p>\u003cul>\u003cli>Read formatted mail or plain text.\u003c/li>\u003cli>Download attachments.\u003c/li>\u003cli>Inspect the sender’s reported SPF, DKIM and DMARC results.\u003c/li>\u003c/ul>\u003cp>These messages are fictional. The demo cannot read or change the EvolveTech mailbox.\u003c/p>\u003cp>Alex\u003c/p>\u003c/div>","auth":{"spf":"pass","dkim":"pass","dmarc":"pass"},"attachments":[]},{"id":"demo-notes-0002","receivedAt":1792918800000,"from":"Sam \u003csam@example.net>","to":"projects@example.com","recipients":["projects@example.com"],"subject":"Notes from our project review","preview":"The deployment notes are attached as a text file.","text":"Hi Morgan,\n\nThe deployment notes are attached as a text file.\n\nEverything in this demo uses reserved example domains. No real email or passwords are included.\n\nSam","html":"","auth":{"spf":"pass","dkim":"pass","dmarc":"pass"},"attachments":[{"filename":"project-notes.txt","contentType":"text/plain","size":74,"data":"RGVtbyBwcm9qZWN0IG5vdGVzCgpDb25maWd1cmUgeW91ciBkb21haW4sIHdlYmhvb2sgYW5kIHByaXZhdGUgaW5ib3ggcGFzc3dvcmQuCg=="}]},{"id":"demo-checks-003","receivedAt":1792911600000,"from":"Sender \u003csender@example.org>","to":"hello@example.com","recipients":["hello@example.com"],"subject":"A message with a failed sender check","preview":"Authentication badges show what the forwarding provider reported.","text":"This fictional message demonstrates a failed sender check. The badges report the forwarding provider’s authentication results; the inbox does not compute these results itself.","html":"","auth":{"spf":"fail","dkim":"none","dmarc":"fail"},"attachments":[]}];
const mailboxLabel = "Evolve Inbox";
const mailDomain = "";
let password = demoMessages ? '' : sessionStorage.getItem('mail-password') || '';
let messages = [];
let current = null;
let query = '';
let attachmentsOnly = false;
let notice = '';
let viewVersion = 0;
let loadVersion = 0;
let attachmentUrls = [];
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) n.append(k); return n; };
const when = (t) => new Date(t).toLocaleString();
const size = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const releaseAttachments = () => { attachmentUrls.forEach((url) => URL.revokeObjectURL(url)); attachmentUrls = []; };
function announce(message) {
  notice = message;
  const status = document.getElementById('mail-notice');
  if (status) status.textContent = message;
}
function report(error) {
  if (!['unauthorized', 'superseded'].includes(error.message)) announce(error.message || 'The request failed. Please retry.');
}
function back() {
  viewVersion++;
  current = null;
  releaseAttachments();
  document.body.classList.remove('reading');
  render();
}

async function api(path, init = {}) {
  if (demoMessages) {
    if (init.method && init.method !== 'GET') throw new Error('This demonstration is read only.');
    if (path === 'messages') return structuredClone(demoMessages.map((m) => ({ ...m, attachments: m.attachments.length })));
    const message = demoMessages.find((m) => path === 'messages/' + m.id);
    if (!message) throw new Error('Message not found.');
    return structuredClone(message);
  }
  const requestPassword = password;
  let res;
  try { res = await fetch('/mail/api/' + path, { ...init, headers: { Authorization: 'Bearer ' + requestPassword }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Couldn’t reach the inbox. Check your connection and try again.'); }
  if (password !== requestPassword) throw new Error('superseded');
  if (res.status === 401) { sessionStorage.removeItem('mail-password'); password = ''; login('That password didn’t work.'); throw new Error('unauthorized'); }
  let data;
  try { data = await res.json(); } catch { throw new Error('The server returned an unexpected response. Please retry.'); }
  if (!res.ok) throw new Error(data.error || 'The request failed. Please retry.');
  return data;
}

function login(problem) {
  viewVersion++;
  loadVersion++;
  current = null;
  messages = [];
  query = '';
  attachmentsOnly = false;
  notice = '';
  releaseAttachments();
  document.body.classList.remove('reading');
  const input = el('input', { type: 'password', placeholder: 'Password', ariaLabel: 'Inbox password', autocomplete: 'current-password', required: true });
  const form = el('form', { className: 'login' }, el('h1', { textContent: mailboxLabel + ' inbox' }), input, el('button', { className: 'primary', type: 'submit', textContent: 'Open inbox' }), el('p', { id: 'mail-notice', className: 'muted notice', role: 'status', ariaLive: 'polite' }));
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
  const version = ++viewVersion;
  announce('');
  releaseAttachments();
  current = id;
  document.body.classList.add('reading');
  render();
  const reader = document.querySelector('.reader');
  reader.replaceChildren(el('button', { textContent: '← Inbox', onclick: back }), el('p', { className: 'muted', textContent: 'Loading message…' }));
  try {
  const m = await api('messages/' + id);
  if (version !== viewVersion) return;
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
    attachmentUrls.push(url);
    atts.append(el('a', { href: url, download: a.filename, textContent: '📎 ' + a.filename + ' (' + size(a.size || bytes.length) + ')' }));
  }
  reader.replaceChildren(
    el('div', { className: 'row' },
      el('button', { textContent: '← Inbox', onclick: back }),
      el('button', { textContent: 'Delete', disabled: !!demoMessages, title: demoMessages ? 'Read-only demonstration' : '', onclick: async (event) => {
        if (!confirm('Delete this message?')) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await api('messages/' + id, { method: 'DELETE' });
          if (version !== viewVersion) return;
          messages = messages.filter((message) => message.id !== id);
          back();
          announce('Message deleted.');
          await load();
        } catch (error) { report(error); }
        finally { button.disabled = false; }
      } })),
    el('h2', { textContent: m.subject }),
    el('div', { className: 'meta' },
      el('span', { textContent: 'From: ' + m.from }),
      el('span', { textContent: 'To: ' + ((m.recipients && m.recipients.join(', ')) || m.to) }),
      m.cc ? el('span', { textContent: 'Cc: ' + m.cc }) : '',
      m.replyTo ? el('span', { textContent: 'Reply to: ' + m.replyTo }) : '',
      el('span', { className: 'muted', textContent: when(m.receivedAt) }),
      el('div', {}, ...authBadges(m.auth))),
    atts, toggles, body);
  m.html ? showHtml() : showText();
  } catch (error) {
    if (version !== viewVersion) return;
    reader.replaceChildren(el('button', { textContent: '← Inbox', onclick: back }), el('p', { textContent: 'Couldn’t open this message.' }), el('button', { textContent: 'Try again', onclick: () => open(id) }));
    report(error);
  }
}

function renderList(list = document.querySelector('.message-list')) {
  if (!list) return;
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered = messages.filter((m) => (!attachmentsOnly || m.attachments > 0) && terms.every((term) => [m.subject, m.from, m.to, m.preview].join(' ').toLocaleLowerCase().includes(term)));
  list.replaceChildren();
  if (!filtered.length) list.append(el('p', { className: 'muted', style: 'padding:16px', textContent: messages.length ? 'No messages match your search.' : 'No mail yet. ' + (mailDomain ? 'Configure forwarding for ' + mailDomain + ', then send a message from another account.' : 'Configure your domain’s forwarding, then send a message from another account.') }));
  for (const m of filtered) {
    list.append(el('button', { className: 'item', onclick: () => open(m.id), ariaCurrent: String(m.id === current) },
      el('strong', { textContent: m.subject }),
      el('span', { className: 'muted', textContent: m.from + ' → ' + m.to }), el('br'),
      el('span', { className: 'muted', textContent: when(m.receivedAt) + (m.attachments ? ' · 📎' + m.attachments : '') }), el('br'),
      el('span', { className: 'muted', textContent: m.preview })));
  }
  const count = document.getElementById('search-count');
  if (count) count.textContent = filtered.length + ' of ' + messages.length + ' messages';
}

function render() {
  const search = el('input', { type: 'search', placeholder: 'Search mail', ariaLabel: 'Search mail', value: query, oninput: (event) => { query = event.target.value; renderList(); } });
  const filter = el('input', { type: 'checkbox', checked: attachmentsOnly, onchange: (event) => { attachmentsOnly = event.target.checked; renderList(); } });
  const list = el('div', { className: 'list' }, el('div', { className: 'tools' }, search,
    el('label', { className: 'muted' }, filter, 'Has attachments'), el('span', { id: 'search-count', className: 'muted', role: 'status', ariaLive: 'polite' })), el('div', { className: 'message-list' }));
  const reader = document.querySelector('.reader') || el('div', { className: 'reader' });
  if (!current) reader.replaceChildren(el('p', { className: 'muted', textContent: 'Select a message to read it.' }));
  const header = el('header', {}, el('h1', { textContent: (demoMessages ? 'Evolve Inbox · Demo' : mailboxLabel + ' inbox') + ' (' + messages.length + ')' }),
    el('div', { className: 'row' }, el('button', { textContent: 'Refresh', onclick: load }),
      ...(!demoMessages ? [el('button', { textContent: 'Setup status', onclick: async () => {
        try { const status = await api('status'); announce(status.ready ? 'Storage is available and an independent webhook secret is configured. ' + status.messageCount + ' messages listed. Send a real message to confirm delivery.' : 'Set MAIL_HOOK_SECRET to a different secret from MAIL_PASSWORD in Netlify, then redeploy.'); }
        catch (error) { report(error); }
      } })] : []),
      el('button', { textContent: demoMessages ? 'Read-only demo' : 'Lock', disabled: !!demoMessages, onclick: () => { sessionStorage.removeItem('mail-password'); password = ''; login(); } })));
  app.replaceChildren(header, ...(demoMessages ? [el('p', { className: 'demo-notice', textContent: 'Fictional messages for this public demo. No connection to the EvolveTech mailbox.' })] : []), el('p', { id: 'mail-notice', className: 'notice muted', role: 'status', ariaLive: 'polite', textContent: notice }), el('div', { className: 'layout' }, list, reader));
  renderList();
}

async function load() {
  if (!password && !demoMessages) return login();
  const version = ++loadVersion;
  try {
    const next = await api('messages');
    if (version !== loadVersion) return;
    if (!Array.isArray(next)) throw new Error('The server returned an unexpected inbox list. Please retry.');
    messages = next;
    if (current && !messages.some((m) => m.id === current)) back();
    render();
    if (demoMessages && !current && messages.length) await open(messages[0].id);
  } catch (error) { if (version === loadVersion) report(error); }
}

load();
setInterval(() => { if (password && !current) load(); }, 30000);
