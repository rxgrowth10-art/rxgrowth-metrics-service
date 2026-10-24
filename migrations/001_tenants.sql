-- Tenant registry for the customer metrics service.
-- api_key_encrypted stores AES-256-GCM ciphertext (v1:iv:tag:ciphertext, base64 parts).
-- The plaintext GoHighLevel private-integration token is never stored.
-- Apply with your Neon SQL runner, for example:
--   psql "$DATABASE_URL" -f migrations/001_tenants.sql

CREATE TABLE IF NOT EXISTS tenants (
  location_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  m10_workflow_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_location_id_not_blank CHECK (length(trim(location_id)) > 0),
  CONSTRAINT tenants_timezone_not_blank CHECK (length(trim(timezone)) > 0),
  CONSTRAINT tenants_currency_not_blank CHECK (length(trim(currency)) > 0)
);

CREATE INDEX IF NOT EXISTS tenants_active_idx ON tenants (active);
