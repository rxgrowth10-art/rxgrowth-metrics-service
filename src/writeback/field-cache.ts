import type { GhlClient } from "../ghl/index.js";
import { GhlRequestError } from "../ghl/errors.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { buildFieldIdMap } from "./fields.js";

export const FIELD_CACHE_TTL_SECONDS = 10 * 60;

export function fieldCacheKey(locationId: string): string {
  return `fields:${locationId}`;
}

export async function loadFieldIdMap(
  client: Pick<GhlClient, "listCustomFields">,
  store: IdempotencyStore,
  locationId: string,
): Promise<Map<string, string>> {
  const cached = await readFieldCache(store, locationId);
  if (cached) return cached;
  return refreshFieldIdMap(client, store, locationId);
}

export async function refreshFieldIdMap(
  client: Pick<GhlClient, "listCustomFields">,
  store: IdempotencyStore,
  locationId: string,
): Promise<Map<string, string>> {
  const map = buildFieldIdMap(await client.listCustomFields());
  await store.set(fieldCacheKey(locationId), JSON.stringify(Object.fromEntries(map)), FIELD_CACHE_TTL_SECONDS);
  return map;
}

export async function invalidateFieldCache(store: IdempotencyStore, locationId: string): Promise<void> {
  await store.del(fieldCacheKey(locationId));
}

export function isUnknownFieldError(error: unknown): boolean {
  if (error instanceof GhlRequestError) return error.status === 400 || error.status === 422;
  return error instanceof Error && error.message.startsWith("Missing custom field ");
}

async function readFieldCache(store: IdempotencyStore, locationId: string): Promise<Map<string, string> | null> {
  const raw = await store.get(fieldCacheKey(locationId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) map.set(key, value);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}
