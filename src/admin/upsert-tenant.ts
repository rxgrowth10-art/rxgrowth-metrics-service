import { createHash, randomBytes } from "node:crypto";
import { encryptApiKey, parseEncryptionKey } from "../tenants/crypto.ts";

export const TENANT_UPSERT_SQL = `
INSERT INTO tenants (
  location_id,
  name,
  api_key_encrypted,
  timezone,
  currency,
  m10_workflow_id,
  webhook_token_hash,
  active,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, NOW()
)
ON CONFLICT (location_id) DO UPDATE SET
  name = EXCLUDED.name,
  api_key_encrypted = EXCLUDED.api_key_encrypted,
  timezone = EXCLUDED.timezone,
  currency = EXCLUDED.currency,
  m10_workflow_id = EXCLUDED.m10_workflow_id,
  webhook_token_hash = EXCLUDED.webhook_token_hash,
  active = EXCLUDED.active,
  updated_at = NOW()
`;

export interface TenantUpsertPlan {
  databaseUrl: string;
  locationId: string;
  token: string;
  params: [string, string, string, string, string, string | null, string, boolean];
}

export function tenantUpsertPlan(env: NodeJS.ProcessEnv, plaintext: string): TenantUpsertPlan {
  const databaseUrl = env.DATABASE_URL?.trim();
  const rawKey = env.TENANT_KEY_ENCRYPTION_KEY?.trim();
  const locationId = env.TENANT_LOCATION_ID?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!rawKey) throw new Error("TENANT_KEY_ENCRYPTION_KEY is not set");
  if (!locationId) throw new Error("TENANT_LOCATION_ID is not set");
  const key = parseEncryptionKey(rawKey);
  if (!plaintext) throw new Error("Pass the GoHighLevel API key on stdin");
  const token = randomBytes(32).toString("base64url");
  return {
    databaseUrl,
    locationId,
    token,
    params: [
      locationId,
      env.TENANT_NAME?.trim() || locationId,
      encryptApiKey(plaintext, key),
      env.TENANT_TIMEZONE?.trim() || "UTC",
      env.TENANT_CURRENCY?.trim() || "USD",
      env.TENANT_M10_WORKFLOW_ID?.trim() || null,
      createHash("sha256").update(token, "utf8").digest("hex"),
      parseActive(env.TENANT_ACTIVE),
    ],
  };
}

function parseActive(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error("TENANT_ACTIVE must be true or false");
}
