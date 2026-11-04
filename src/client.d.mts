export interface SenderChecks { spf: string; dkim: string; dmarc: string }
export interface MessageSummary {
  id: string; receivedAt: number; from: string; to: string; subject: string;
  preview: string; attachments: number; auth: SenderChecks;
}
export interface Attachment { filename: string; contentType: string; size: number; data: string }
export interface Message {
  id: string; receivedAt: number; from: string; to: string; recipients: string[];
  subject: string; text: string; html: string; attachments: Attachment[]; auth: SenderChecks;
}
export interface InboxStatus {
  ready: boolean; storage: string; inboundConfigured: boolean; label: string;
  domain: string; messageCount: number; latestReceivedAt: number | null;
}
export type InboxErrorCode = 'unauthorized' | 'throttled' | 'unavailable' | 'not_found' | 'invalid_response' | 'network' | 'aborted' | 'request_failed';
export class InboxError extends Error {
  constructor(code: InboxErrorCode, status?: number, retryAfter?: number | null);
  code: InboxErrorCode; status: number; retryAfter: number | null;
}
export interface RequestOptions { signal?: AbortSignal }
export interface InboxClient {
  list(options?: RequestOptions): Promise<MessageSummary[]>;
  status(options?: RequestOptions): Promise<InboxStatus>;
  get(id: string, options?: RequestOptions): Promise<Message>;
  delete(id: string, options?: RequestOptions): Promise<{ ok: true }>;
}
export function createClient(options: {
  site: string; password: string; fetch?: typeof globalThis.fetch; timeoutMs?: number;
}): InboxClient;
