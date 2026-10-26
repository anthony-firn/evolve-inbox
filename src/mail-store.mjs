import { setTimeout } from 'node:timers/promises';

// Conditional writes in some Blobs SDK versions report a failed write as modified
// with an empty ETag. Never acknowledge delivery unless storage confirms the write.
export async function writeJSON(store, key, value, conditions) {
  const result = await store.setJSON(key, value, conditions);
  if (!result || (result.modified && !result.etag)) throw new Error('Storage did not confirm the write');
  return result.modified;
}

/** Keep the existing index format, but never overwrite another delivery's changes. */
export async function updateIndex(store, change) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const entry = await store.getWithMetadata('index', { type: 'json' });
    if (entry && !entry.etag) throw new Error('Storage did not provide an index version');
    const index = entry?.data ?? [];
    const next = change(index);
    if (next === index) return;
    if (await writeJSON(store, 'index', next, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true })) return;
    await setTimeout(5 + Math.random() * Math.min(100, (attempt + 1) * 10));
  }
  throw new Error('Inbox is busy; delivery must be retried');
}

export function metadata(item) {
  return {
    id: item.id, receivedAt: item.receivedAt, from: item.from,
    to: item.recipients.join(', ') || item.to, subject: item.subject,
    preview: item.text.replace(/\s+/g, ' ').slice(0, 140),
    attachments: item.attachments.length, auth: item.auth,
  };
}
