import { readFile } from 'node:fs/promises';
import { metadata } from './mail-store.mjs';

const insert = `INSERT INTO evolve_inbox_messages
  (id, received_at, sender, recipients, subject, preview, attachment_count, auth, content)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`;

function values(item) {
  if (!item || !/^[a-z0-9-]{10,40}$/.test(item.id) || !Number.isSafeInteger(item.receivedAt) || item.receivedAt < 0 ||
      !['from', 'to', 'subject', 'text', 'html'].every((key) => typeof item[key] === 'string') ||
      !Array.isArray(item.recipients) || item.recipients.some((v) => typeof v !== 'string') ||
      !Array.isArray(item.attachments) || !item.auth || typeof item.auth !== 'object' || Array.isArray(item.auth)) {
    throw new TypeError('Invalid stored message');
  }
  const m = metadata(item);
  return [m.id, m.receivedAt, m.from, m.to, m.subject, m.preview, m.attachments, JSON.stringify(m.auth), JSON.stringify(item)];
}

async function transaction(pool, run) {
  const client = await pool.connect();
  let failure;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    failure = error;
    try { await client.query('ROLLBACK'); } catch { /* Original error is more useful; release destroys bad connections below. */ }
    throw error;
  } finally {
    client.release(failure);
  }
}

/** Optional adapter. Message and listing fields are one row, so they commit together.
 * Authentication keeps the same versioned conditional-write contract as Blobs.
 * The caller owns the pool and its shutdown; constructing this object runs no SQL.
 */
export function createPostgresStore(pool) {
  return {
    async migrate() {
      const sql = await readFile(new URL('../db/001-inbox.sql', import.meta.url), 'utf8');
      await transaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(17293811)");
        await client.query(sql);
      });
    },
    async receiveMessage(item) {
      // One INSERT is a database transaction. Retries never rewrite original contents/time.
      await pool.query(insert, values(item));
    },
    async deleteMessage(id) {
      await pool.query('DELETE FROM evolve_inbox_messages WHERE id=$1', [id]);
    },
    async get(key) {
      if (key === 'index') {
        const { rows } = await pool.query(`SELECT id, received_at, sender, recipients, subject, preview, attachment_count, auth
          FROM evolve_inbox_messages ORDER BY received_at DESC, id DESC LIMIT 2000`);
        return rows.map((r) => ({ id: r.id, receivedAt: Number(r.received_at), from: r.sender, to: r.recipients,
          subject: r.subject, preview: r.preview, attachments: r.attachment_count, auth: r.auth }));
      }
      if (key.startsWith('msg/')) {
        return (await pool.query('SELECT content FROM evolve_inbox_messages WHERE id=$1', [key.slice(4)])).rows[0]?.content ?? null;
      }
      return (await pool.query('SELECT value FROM evolve_inbox_state WHERE key=$1', [key])).rows[0]?.value ?? null;
    },
    async getWithMetadata(key) {
      if (!key.startsWith('security/auth/')) throw new TypeError('Only authentication state uses conditional writes');
      const row = (await pool.query('SELECT value, revision FROM evolve_inbox_state WHERE key=$1', [key])).rows[0];
      return row ? { data: row.value, etag: String(row.revision) } : null;
    },
    async setJSON(key, value, conditions = {}) {
      if (!key.startsWith('security/auth/')) throw new TypeError('Use receiveMessage for mail');
      if (conditions.onlyIfNew && conditions.onlyIfMatch) throw new TypeError('Conflicting write conditions');
      let result;
      if (conditions.onlyIfMatch) {
        result = await pool.query(`UPDATE evolve_inbox_state SET value=$2, revision=nextval('evolve_inbox_revision')
          WHERE key=$1 AND revision::text=$3 RETURNING revision`, [key, JSON.stringify(value), conditions.onlyIfMatch]);
      } else {
        const conflict = conditions.onlyIfNew ? 'DO NOTHING' :
          "DO UPDATE SET value=EXCLUDED.value, revision=nextval('evolve_inbox_revision')";
        result = await pool.query(`INSERT INTO evolve_inbox_state(key,value) VALUES($1,$2)
          ON CONFLICT (key) ${conflict} RETURNING revision`, [key, JSON.stringify(value)]);
      }
      return result.rowCount ? { modified: true, etag: String(result.rows[0].revision) } : { modified: false };
    },
    async exportMessages() {
      // Unlike the reader's 2,000-row list, a backup includes every retained message.
      return (await pool.query('SELECT content FROM evolve_inbox_messages ORDER BY received_at,id')).rows.map((r) => r.content);
    },
    async importMessages(messages) {
      if (!Array.isArray(messages)) throw new TypeError('Expected a message array');
      return transaction(pool, async (client) => {
        let imported = 0;
        for (const item of messages) imported += (await client.query(insert, values(item))).rowCount;
        return { imported, existing: messages.length - imported };
      });
    },
  };
}

export async function openPostgres(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, idle_in_transaction_session_timeout: 15000 });
  // pg emits errors for disconnected idle clients. Never log connection strings or raw provider errors.
  pool.on('error', () => console.error('PostgreSQL idle connection unavailable'));
  return { pool, store: createPostgresStore(pool) };
}
