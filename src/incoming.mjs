import { createHash, randomUUID } from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 5_000_000;

export class InvalidMail extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const text = (value, fallback = '') => {
  if (value == null) return fallback;
  if (typeof value !== 'string') throw new InvalidMail('Message text fields must be strings.');
  return value;
};
const addresses = (field) => {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (!Array.isArray(field.value)) return text(field.text);
  return field.value.map((v) => v && (v.name ? `${text(v.name)} <${text(v.address)}>` : text(v.address))).filter(Boolean).join(', ');
};
const result = (check) => {
  const value = check?.status?.result ?? check?.result ?? (Array.isArray(check?.results) ? check.results[0]?.status?.result : undefined);
  return typeof value === 'string' ? value : undefined;
};

/** Bound the actual streamed body, including requests without Content-Length. */
export async function readIncoming(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) throw new InvalidMail('Use application/json with parsed email content.', 415);
  if (Number(req.headers.get('content-length')) > MAX_WEBHOOK_BYTES) throw new InvalidMail('Message exceeds the 5 MB webhook limit.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new InvalidMail('A parsed email object is required.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new InvalidMail('Message exceeds the 5 MB webhook limit.', 413);
    }
    chunks.push(value);
  }
  let msg;
  try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InvalidMail('Invalid JSON. Send parsed email with raw=false.'); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new InvalidMail('A parsed email object is required.');
  if (msg.recipients != null && (!Array.isArray(msg.recipients) || msg.recipients.some((v) => typeof v !== 'string'))) throw new InvalidMail('Recipients must be an array of email addresses.');
  if (msg.attachments != null && !Array.isArray(msg.attachments)) throw new InvalidMail('Attachments must be an array.');
  const item = {
    receivedAt: Date.now(), date: text(msg.date), messageId: text(msg.messageId),
    from: addresses(msg.from), to: addresses(msg.to), cc: addresses(msg.cc),
    recipients: msg.recipients ?? [], replyTo: addresses(msg.replyTo),
    subject: text(msg.subject) || '(no subject)', text: text(msg.text),
    // mailparser also uses false when a message has no HTML alternative.
    html: msg.html === false ? '' : text(msg.html),
    auth: { spf: result(msg.spf), dkim: result(msg.dkim), dmarc: result(msg.dmarc) },
    attachments: (msg.attachments ?? []).map((a) => {
      if (!a || typeof a !== 'object') throw new InvalidMail('Invalid attachment.');
      const content = a.content?.data ?? a.content ?? [];
      let bytes;
      if (Array.isArray(content) && content.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) bytes = Buffer.from(content);
      else if (typeof content === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) bytes = Buffer.from(content, 'base64');
      else throw new InvalidMail('Attachment content must be a byte array or base64.');
      return { filename: text(a.filename) || 'attachment', contentType: text(a.contentType) || 'application/octet-stream', size: bytes.length, data: bytes.toString('base64') };
    }),
  };
  // The same Message-ID can be used for different recipients or different bodies.
  // Exclude delivery time and authentication reports, which may change on retries.
  const fingerprint = [item.messageId, [...item.recipients].sort(), item.date, item.from, item.to, item.cc, item.replyTo, item.subject, item.text, item.html, item.attachments];
  item.id = item.messageId
    ? 'mail-' + createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 32)
    : `${Date.now().toString(36).padStart(9, '0')}-${randomUUID().slice(0, 8)}`;
  return item;
}
