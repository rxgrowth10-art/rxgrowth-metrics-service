import { createGhlClient, type GhlClient } from "../ghl";
import { createIdempotencyStore, type IdempotencyStore } from "../idempotency";
import {
  createEnvTenantStore,
  createNeonTenantStore,
  parseEncryptionKey,
  type TenantStore,
} from "../tenants";

export interface AppDeps {
  tenants: TenantStore;
  idempotency: IdempotencyStore;
  encryptionKey: Buffer;
  webhookSecret: string | null;
  cronSecret: string | null;
  enrollEnabled: boolean;
  ghlFactory: (args: { apiKey: string; locationId: string }) => GhlClient;
  now: () => Date;
}

export function createDefaultDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  const keyRaw = env.TENANT_ENCRYPTION_KEY;
  if (!keyRaw) throw new Error("TENANT_ENCRYPTION_KEY is not set");
  const encryptionKey = parseEncryptionKey(keyRaw);
  const baseUrl = env.GHL_API_BASE_URL;
  return {
    tenants: createTenantStore(env, encryptionKey),
    idempotency: createIdempotencyStore(env),
    encryptionKey,
    webhookSecret: emptyToNull(env.WEBHOOK_SHARED_SECRET),
    cronSecret: emptyToNull(env.CRON_SECRET),
    enrollEnabled: env.M10_ENROLL_ENABLED === "true",
    ghlFactory: ({ apiKey, locationId }) =>
      createGhlClient({
        apiKey,
        locationId,
        ...(baseUrl ? { baseUrl } : {}),
        minIntervalMs: 100,
      }),
    now: () => new Date(),
  };
}

function createTenantStore(env: NodeJS.ProcessEnv, encryptionKey: Buffer): TenantStore {
  const driver = env.TENANT_STORE?.trim().toLowerCase() || "neon";
  if (driver === "env") return createEnvTenantStore(encryptionKey, env);
  if (driver === "neon") {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");
    return createNeonTenantStore(databaseUrl);
  }
  throw new Error('TENANT_STORE must be "neon" or "env"');
}

function emptyToNull(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  return value;
}
