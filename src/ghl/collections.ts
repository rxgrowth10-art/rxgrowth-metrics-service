import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import type { GhlClient } from "./types.js";

/** One day. A hit is a single GET. A miss refreshes the whole map. */
export const COLLECTIONS_TTL_SECONDS = 24 * 60 * 60;

export function collectionsCacheKey(locationId: string): string {
  return `m06:collections:${locationId}`;
}

export interface CollectionNames {
  /** Id to name. Null means the id was looked up and has no name. */
  names: ReadonlyMap<string, string | null>;
  /**
   * False when a refresh was required and GHL failed.
   * The caller leaves category fields off the contact and out of the hash.
   */
  ok: boolean;
}

/**
 * Per-location collection names. The steady path is one Redis read.
 * A missing key, or any requested id absent from the map, is one
 * `listCollections` call (the client chunks at 100 ids) and one SET.
 * Rate limits and timeouts fail open: `ok` is false and the stored map is left as it was.
 */
export async function loadCollectionNames(args: {
  store: IdempotencyStore;
  client: Pick<GhlClient, "listCollections">;
  locationId: string;
  ids: readonly string[];
}): Promise<CollectionNames> {
  const needed = uniqueIds(args.ids);
  if (needed.length === 0) return { names: new Map(), ok: true };
  const key = collectionsCacheKey(args.locationId);
  try {
    const cached = await readCache(args.store, key);
    const missing = needed.filter((id) => !cached.has(id));
    if (missing.length === 0) return { names: cached, ok: true };
    const fetched = await args.client.listCollections(missing);
    const byId = new Map(fetched.map((row) => [row.id, row.name]));
    const merged = new Map(cached);
    for (const id of missing) {
      const name = byId.get(id)?.trim();
      merged.set(id, name ? name : null);
    }
    await args.store.set(key, JSON.stringify(Object.fromEntries(merged)), COLLECTIONS_TTL_SECONDS);
    return { names: merged, ok: true };
  } catch (error) {
    log("warn", "m06.collections_refresh_failed", {
      locationId: args.locationId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { names: new Map(), ok: false };
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

async function readCache(store: IdempotencyStore, key: string): Promise<Map<string, string | null>> {
  const raw = await store.get(key);
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const names = new Map<string, string | null>();
    for (const [id, value] of Object.entries(parsed)) {
      if (!id) continue;
      if (typeof value === "string" && value.trim()) names.set(id, value.trim());
      else if (value === null) names.set(id, null);
    }
    return names;
  } catch {
    return new Map();
  }
}
