import { encryptApiKey } from "./crypto";
import type { Tenant, TenantStore } from "./types";

interface TenantInput {
  locationId: string;
  name: string;
  apiKey: string | null;
  apiKeyEncrypted: string | null;
  timezone: string;
  currency: string;
  m10WorkflowId: string | null;
  webhookTokenHash: string | null;
  active: boolean;
}

/**
 * One tenant from the environment, for the test phase before Neon is provisioned.
 * `TENANT_CONFIG` (JSON) wins when it is non-empty. Otherwise discrete `TENANT_*` vars are used.
 * A plaintext `apiKey` is encrypted with `encryptionKey` before it is stored on the tenant.
 * `upsert` updates this process only and does not write back to the environment.
 */
export function createEnvTenantStore(
  encryptionKey: Buffer,
  env: NodeJS.ProcessEnv = process.env,
): TenantStore {
  let current = toTenant(readTenantInput(env), encryptionKey);
  return {
    async getByLocationId(locationId) {
      return current.locationId === locationId ? { ...current } : null;
    },
    async listActive() {
      return current.active ? [{ ...current }] : [];
    },
    async upsert(tenant) {
      current = { ...tenant };
    },
  };
}

export function readTenantInput(env: NodeJS.ProcessEnv): TenantInput {
  const config = env.TENANT_CONFIG?.trim();
  if (config) return parseTenantConfig(config);
  const locationId = requiredText(env.TENANT_LOCATION_ID, "TENANT_LOCATION_ID");
  return {
    locationId,
    name: optionalText(env.TENANT_NAME) ?? locationId,
    apiKey: optionalText(env.TENANT_API_KEY),
    apiKeyEncrypted: optionalText(env.TENANT_API_KEY_ENCRYPTED),
    timezone: optionalText(env.TENANT_TIMEZONE) ?? "UTC",
    currency: optionalText(env.TENANT_CURRENCY) ?? "USD",
    m10WorkflowId: optionalText(env.TENANT_M10_WORKFLOW_ID),
    webhookTokenHash: webhookHash(env.TENANT_WEBHOOK_TOKEN_HASH),
    active: parseActive(env.TENANT_ACTIVE),
  };
}

function parseTenantConfig(raw: string): TenantInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TENANT_CONFIG is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TENANT_CONFIG must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const locationId = requiredText(record.locationId, "TENANT_CONFIG.locationId");
  return {
    locationId,
    name: optionalText(record.name) ?? locationId,
    apiKey: optionalText(record.apiKey),
    apiKeyEncrypted: optionalText(record.apiKeyEncrypted),
    timezone: optionalText(record.timezone) ?? "UTC",
    currency: optionalText(record.currency) ?? "USD",
    m10WorkflowId: optionalText(record.m10WorkflowId),
    webhookTokenHash: webhookHash(record.webhookTokenHash),
    active: record.active === undefined ? true : parseActive(record.active),
  };
}

function toTenant(input: TenantInput, encryptionKey: Buffer): Tenant {
  if (input.apiKey && input.apiKeyEncrypted) {
    throw new Error("Tenant config accepts only one of apiKey or apiKeyEncrypted");
  }
  const apiKeyEncrypted = input.apiKeyEncrypted ?? (input.apiKey ? encryptApiKey(input.apiKey, encryptionKey) : null);
  if (!apiKeyEncrypted) throw new Error("Tenant config requires apiKey or apiKeyEncrypted");
  return {
    locationId: input.locationId,
    name: input.name,
    apiKeyEncrypted,
    timezone: input.timezone,
    currency: input.currency,
    m10WorkflowId: input.m10WorkflowId,
    webhookTokenHash: input.webhookTokenHash,
    active: input.active,
  };
}

function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`${label} is required when TENANT_STORE=env`);
  return text;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Tenant config text fields must be strings");
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function webhookHash(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("webhookTokenHash must be a 64-character sha256 hex digest");
  }
  return normalized;
}

function parseActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  throw new Error("Tenant active must be a boolean");
}
