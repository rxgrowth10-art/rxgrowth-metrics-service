-- Per-tenant webhook query token. Store only the SHA-256 hex digest.
-- Apply after 001_tenants.sql:
--   psql "$DATABASE_URL" -f migrations/002_webhook_token.sql

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_token_hash TEXT;
