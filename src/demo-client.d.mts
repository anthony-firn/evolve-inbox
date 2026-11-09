import type { InboxClient } from './client.mjs';
/** Read-only fictional mail; performs no network requests. */
export function createDemoClient(): InboxClient;
