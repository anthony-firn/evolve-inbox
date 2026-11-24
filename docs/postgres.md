# PostgreSQL storage for a self-hosted inbox

The existing Netlify Blobs deployment remains the default. This optional Node.js server uses the same webhook parser, authentication controls, API and reader, with PostgreSQL storage. It has been tested against a disposable PostgreSQL 17 instance. It has not been used for the live EvolveTech mailbox or tested as a highly available mail service.

## Why a second backend

Blobs stores a message and an inbox index as separate objects. Conditional writes protect concurrent index updates; a provider retry can repair an interrupted save. There is no transaction across those objects.

PostgreSQL stores the complete parsed message and the fields used by the listing in one row. A single INSERT commits both. The listing is an ordered SELECT, not a second mutable index document. The primary key is the parser's existing delivery ID; `ON CONFLICT DO NOTHING` preserves the original message and receipt time on retries. Deletion removes the row, including its listing fields.

This is a small-inbox design: attachments remain base64 in JSONB, with the same 5 MB parsed-webhook limit. It is not a large-attachment object store. The reader still lists the newest 2,000 rows; backup export includes every retained row. There is no retention job.

## Run

Use Node 22+ and PostgreSQL 17. Install with `npm ci` (do not omit optional dependencies for this backend). Set `DATABASE_URL` through your service's secret environment, and set independent random `MAIL_PASSWORD` and `MAIL_HOOK_SECRET` values of at least 20 characters. Configure `MAIL_DOMAIN` and `MAIL_LABEL` as for Netlify. Never commit these settings or put them in command-line arguments.

```sh
npm run postgres -- migrate
npm run serve:postgres
```

The migration is explicit and idempotent. It creates two prefixed tables, a revision sequence and a descending timestamp/ID index. An advisory transaction lock serializes migration calls. It does not inspect or copy any Netlify mailbox. Give the migration connection schema-creation rights; the runtime role needs SELECT/INSERT/UPDATE/DELETE on the two tables and USAGE on the sequence, not schema ownership.

The server binds to 127.0.0.1:4195 by default. `MAIL_HTTP_HOST` and `MAIL_HTTP_PORT` override that. Put it behind a reverse proxy that provides HTTPS and request limits before configuring a forwarding provider. Forward parsed JSON to the same `/mail/hook/<secret>` path. Reader routes remain `/mail` and `/mail/api/*`. Configure a valid CA for remote database TLS; the adapter does not turn certificate verification off.

Authentication uses the socket peer address, never caller-controlled forwarding headers. All clients behind one reverse proxy share its failure budget. That is conservative and can affect availability; use perimeter controls. Connection pools are limited to five clients per server process, with connection and statement timeouts. Pool errors are logged without provider details or credentials. A multi-process deployment must budget its total database connections.

## Backup, restore and cutover

Set `MAIL_EXPORT_FILE` to a private local filename. Export creates it exclusively with mode 0600 and refuses to overwrite an existing file. Output contains message bodies and attachments: protect it like the mailbox. Neither operation logs its contents.

```sh
npm run postgres -- export
npm run postgres -- import
```

The JSON format is `{ "format": "evolve-inbox.messages.v1", "messages": [...] }`, where each element is a stored message object, including its original ID and receivedAt. Import uses one transaction on one checked-out connection. Invalid data or a failed SQL statement rolls back the whole batch. Existing IDs are retained unchanged, so repeating a completed import is harmless. A connection lost during COMMIT can still leave an uncertain outcome; inspect the database or repeat the idempotent import. Export reads all message rows in a single SELECT snapshot. These tools currently hold the backup in memory; use database-native backups for larger installations.

For a Blobs cutover, first take a provider-level backup and stop new delivery writes temporarily. Enumerate **all** `msg/` objects from the source store, not just the 2,000 entries exposed by the reader API. Convert their stored JSON objects into this export envelope. The repository does not automate that provider-specific extraction. Import into an empty PostgreSQL database and verify all IDs and contents before switching the forwarding route. Retain the old store and export until recovery has been checked. Restoring forwarding to Blobs alone does not copy messages received since cutover; reconcile those explicitly. Never operate both receiving backends as if they share duplicate protection.

## Checks and remaining limits

```sh
npm test
npm run typecheck
npm run test:postgres
```

`test:postgres` requires `TEST_DATABASE_URL` for a disposable database with schema-creation rights. Each run creates and removes its own random schema. The suite performs real concurrent inserts, duplicate delivery, SQL-error rollback, backend termination before commit, stale authentication-release rejection, HTTP-handler receive/read/delete, and export/restore beyond the reader limit. CI runs it against PostgreSQL 17. There are no real messages or production credentials in the fixtures.

No guaranteed uptime, throughput or production PostgreSQL experience is implied by these tests. HA, failover, managed backup restoration, larger mailbox load and cross-provider cutover have not been exercised. A provider retry after deleting a message can reinsert it, and messages without a Message-ID still cannot be reliably deduplicated. The single-password owner model and lack of a second factor remain unchanged.
