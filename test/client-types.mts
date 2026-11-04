import { createClient, InboxError, type Message, type MessageSummary, type InboxStatus } from 'evolve-inbox/client';
const client = createClient({ site: 'https://example.com', password: 'example-only' });
const messages: MessageSummary[] = await client.list();
const status: InboxStatus = await client.status();
const message: Message = await client.get(messages[0].id);
const deleted: { ok: true } = await client.delete(message.id, { signal: new AbortController().signal });
void status; void deleted;
const error = new InboxError('throttled', 429, 60);
const delay: number | null = error.retryAfter;
void delay;
// @ts-expect-error IDs must be strings.
client.get(123);
// @ts-expect-error This API has no sending capability.
client.send({ to: 'example@example.com' });
