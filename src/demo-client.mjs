import { createClient } from './client.mjs';
import { messages } from '../demo/messages.mjs';

/** Offline, read-only fixtures through the same Fetch client as a live inbox. */
export function createDemoClient() {
  return createClient({ site: 'https://demo.example', password: 'fictional-demo', fetch: async (url, options) => {
    options.signal.throwIfAborted();
    const path = new URL(url).pathname;
    if (options.method !== 'GET') return Response.json({ error: 'Read-only demonstration' }, { status: 403 });
    if (path === '/mail/api/status') return Response.json({ ready: true, storage: 'fixture', inboundConfigured: false,
      label: 'Fictional inbox', domain: 'example.com', messageCount: messages.length, latestReceivedAt: messages[0].receivedAt });
    if (path === '/mail/api/messages') return Response.json(messages.map(({ id, receivedAt, from, to, subject, preview, attachments, auth }) =>
      ({ id, receivedAt, from, to, subject, preview, attachments: attachments.length, auth })));
    const item = messages.find(m => path === '/mail/api/messages/' + m.id);
    return item ? Response.json(item) : Response.json({ error: 'Not found' }, { status: 404 });
  } });
}
