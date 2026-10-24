-- Per-tenant webhook query token. Store only the SHA-256 hex digest.
-- Applied with the other files by `npm run db:migrate` (DATABASE_URL_UNPOOLED).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_token_hash TEXT;
