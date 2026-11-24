-- Applied explicitly by the operator, never by an incoming request.
CREATE SEQUENCE IF NOT EXISTS evolve_inbox_revision;
CREATE TABLE IF NOT EXISTS evolve_inbox_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT nextval('evolve_inbox_revision')
);
CREATE TABLE IF NOT EXISTS evolve_inbox_messages (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{10,40}$'),
  received_at bigint NOT NULL CHECK (received_at >= 0),
  sender text NOT NULL,
  recipients text NOT NULL,
  subject text NOT NULL,
  preview text NOT NULL,
  attachment_count integer NOT NULL CHECK (attachment_count >= 0),
  auth jsonb NOT NULL,
  content jsonb NOT NULL CHECK (content->>'id' = id)
);
CREATE INDEX IF NOT EXISTS evolve_inbox_recent
  ON evolve_inbox_messages (received_at DESC, id DESC);
