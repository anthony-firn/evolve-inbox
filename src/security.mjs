import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const AUTH_WINDOW_MS = 60_000;
export const AUTH_SLOTS = 20;
export const AUTH_BUCKETS = 256;

export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

// A previous credential is accepted only with an explicit, near-term UTC deadline.
export function credential(value, name, setting, now = Date.now()) {
  if (same(value, setting(name))) return 'current';
  const previous = setting(name + '_PREVIOUS');
  const deadline = setting(name + '_PREVIOUS_UNTIL');
  const until = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(deadline) ? Date.parse(deadline) : NaN;
  const other = name === 'MAIL_PASSWORD' ? 'MAIL_HOOK_SECRET' : 'MAIL_PASSWORD';
  if (setting(name) && previous && !same(previous, setting(other)) && !same(previous, setting(other + '_PREVIOUS')) &&
      until > now && until <= now + 86_400_000 && same(value, previous)) return 'previous';
  return null;
}

/** Reserve before checking credentials. No counters or read-modify-write increments.
 * Fixed buckets bound storage; collisions and clients behind NAT share a budget.
 * Only platform context.ip is trusted. Headers never select a bucket.
 */
export async function reserveAuthentication(store, context, secret, now = Date.now()) {
  const ip = typeof context?.ip === 'string' && isIP(context.ip) ? context.ip : 'unknown';
  const bucket = createHmac('sha256', secret || 'unconfigured').update(ip).digest().readUInt16BE(0) % AUTH_BUCKETS;
  let retryAt = now + AUTH_WINDOW_MS;
  for (let slot = 0; slot < AUTH_SLOTS; slot++) {
    const key = `security/auth/${bucket}/${slot}`;
    const entry = await store.getWithMetadata(key, { type: 'json' });
    if (entry && (!entry.etag || !Number.isFinite(entry.data?.until))) throw new Error('Invalid authentication reservation');
    if (entry?.data.until > now) { retryAt = Math.min(retryAt, entry.data.until); continue; }
    const result = await store.setJSON(key, { until: now + AUTH_WINDOW_MS }, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (!result || (result.modified && !result.etag)) throw new Error('Unconfirmed authentication reservation');
    if (!result.modified) continue;
    // Release by version so a slow successful request cannot erase a newer lease.
    return { release: async () => {
      const released = await store.setJSON(key, { until: 0 }, { onlyIfMatch: result.etag });
      if (!released || (released.modified && !released.etag)) throw new Error('Unconfirmed authentication release');
    } };
  }
  return { retryAfter: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
}

// Keep the schema closed: never accept request URLs, exception messages or mail data.
const events = new Set(['auth_rejected', 'auth_throttled', 'previous_credential_used', 'delivery_accepted', 'message_deleted', 'storage_unavailable']);
export function auditEvent(sink, event, surface, now = Date.now()) {
  if (!events.has(event) || !['reader', 'inbound'].includes(surface)) return;
  try { sink({ schema: 'evolve-inbox.audit.v1', at: new Date(now).toISOString(), event, surface }); }
  catch { /* Telemetry must not change delivery or authentication outcomes. */ }
}
