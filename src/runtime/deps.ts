import { createGhlClient, type GhlClient } from "../ghl";
import { createIdempotencyStore, type IdempotencyStore } from "../idempotency";
import { createNeonTenantStore, parseEncryptionKey, type TenantStore } from "../tenants";

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

export function createDefaultDeps(): AppDeps {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const keyRaw = process.env.TENANT_ENCRYPTION_KEY;
  if (!keyRaw) throw new Error("TENANT_ENCRYPTION_KEY is not set");
  const baseUrl = process.env.GHL_API_BASE_URL;
  return {
    tenants: createNeonTenantStore(databaseUrl),
    idempotency: createIdempotencyStore(),
    encryptionKey: parseEncryptionKey(keyRaw),
    webhookSecret: emptyToNull(process.env.WEBHOOK_SHARED_SECRET),
    cronSecret: emptyToNull(process.env.CRON_SECRET),
    enrollEnabled: process.env.M10_ENROLL_ENABLED === "true",
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

function emptyToNull(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  return value;
}
