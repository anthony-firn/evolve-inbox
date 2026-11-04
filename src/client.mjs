/** Fetch-based client. No background retries, redirects, persistence or telemetry. */
export class InboxError extends Error {
  constructor(code, status = 0, retryAfter = null) {
    super({ unauthorized: 'Inbox credentials were rejected.', throttled: 'Inbox authentication is temporarily throttled.',
      unavailable: 'Inbox is unavailable.', not_found: 'Inbox resource was not found.', invalid_response: 'Inbox returned an invalid response.',
      network: 'Inbox request failed.', aborted: 'Inbox request was cancelled or timed out.', request_failed: 'Inbox request was rejected.' }[code]);
    this.name = 'InboxError'; this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

export function createClient({ site, password, fetch: request = globalThis.fetch, timeoutMs = 10000 }) {
  const url = new URL(site);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('site must be an HTTPS origin');
  if (typeof password !== 'string' || !password || /[\r\n]/.test(password)) throw new TypeError('password is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('timeoutMs must be between 1 and 60000');
  async function call(path, method, { signal } = {}) {
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await request(url.origin + '/mail/api/' + path, {
        method, headers: { Authorization: 'Bearer ' + password, Accept: 'application/json' },
        redirect: 'error', cache: 'no-store', credentials: 'omit', signal: combined,
      });
      if (!response.ok) {
        const status = response.status;
        const seconds = response.headers.get('Retry-After');
        const retryAfter = /^\d+$/.test(seconds ?? '') && Number.isSafeInteger(Number(seconds)) ? Number(seconds) : null;
        throw new InboxError(status === 401 ? 'unauthorized' : status === 429 ? 'throttled' : status === 404 ? 'not_found' : status >= 500 ? 'unavailable' : 'request_failed', status, retryAfter);
      }
      try { return await response.json(); } catch { throw new InboxError(combined.aborted ? 'aborted' : 'invalid_response', combined.aborted ? 0 : response.status); }
    } catch (error) {
      if (error instanceof InboxError) throw error;
      throw new InboxError(combined.aborted ? 'aborted' : 'network');
    }
  }
  const id = (value) => { if (!/^[a-z0-9-]{10,40}$/.test(value)) throw new TypeError('Invalid message ID'); return value; };
  return Object.freeze({
    list: (options) => call('messages', 'GET', options),
    status: (options) => call('status', 'GET', options),
    get: (messageId, options) => call('messages/' + id(messageId), 'GET', options),
    delete: (messageId, options) => call('messages/' + id(messageId), 'DELETE', options),
  });
}
