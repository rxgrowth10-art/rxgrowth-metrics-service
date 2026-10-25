import type { GhlClient } from "../ghl/index.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { computeM06, type MetricOrder } from "../metrics/index.js";
import { M06_WRITTEN_KEYS } from "../schema/fields.js";
import { businessDateString } from "../time/business-date.js";
import { invalidateFieldCache, isUnknownFieldError, loadFieldIdMap, refreshFieldIdMap } from "./field-cache.js";
import { buildFieldIdMap, readContactField, requireFieldId } from "./fields.js";
import { formatM06Values } from "./format.js";
import { metricsHash } from "./hash.js";

/**
 * Detail-derived keys. An incomplete summary pass leaves them out of the
 * contact update and out of the hash. A complete pass includes them in the
 * hash, so that later write is not skipped, and a second incomplete pass
 * with the same list metrics does not rewrite.
 */
export const M06_DETAIL_FIELD_KEYS = [
  "favorite_item",
  "top_items",
  "preferred_order_type",
  "preferred_location",
] as const;

const DETAIL_KEYS = new Set<string>(M06_DETAIL_FIELD_KEYS);
const BLANK_OMIT = new Set(["last_order_type", "preferred_order_type", "primary_order_source"]);

export interface WriteM06Result {
  written: boolean;
  hash: string;
  reason: "updated" | "unchanged";
}

export async function writeM06Metrics(args: {
  client: GhlClient;
  contactId: string;
  orders: readonly MetricOrder[];
  timeZone: string;
  now: Date;
  fieldCache?: { store: IdempotencyStore; locationId: string };
  /**
   * False when the summary pass is incomplete. Detail fields stay off the
   * contact and out of the hash. Defaults to true for a caller that already
   * has the order lines in hand.
   */
  orderDetailsComplete?: boolean;
}): Promise<WriteM06Result> {
  try {
    const ids = await resolveFieldIds(args);
    return await writeWithIds(args, ids);
  } catch (error) {
    if (!args.fieldCache || !isUnknownFieldError(error)) throw error;
    await invalidateFieldCache(args.fieldCache.store, args.fieldCache.locationId);
    const ids = await refreshFieldIdMap(args.client, args.fieldCache.store, args.fieldCache.locationId);
    return writeWithIds(args, ids);
  }
}

async function resolveFieldIds(args: {
  client: GhlClient;
  fieldCache?: { store: IdempotencyStore; locationId: string };
}): Promise<Map<string, string>> {
  if (!args.fieldCache) return buildFieldIdMap(await args.client.listCustomFields());
  return loadFieldIdMap(args.client, args.fieldCache.store, args.fieldCache.locationId);
}

async function writeWithIds(
  args: {
    client: GhlClient;
    contactId: string;
    orders: readonly MetricOrder[];
    timeZone: string;
    now: Date;
    orderDetailsComplete?: boolean;
  },
  ids: ReadonlyMap<string, string>,
): Promise<WriteM06Result> {
  const metrics = computeM06(args.orders, args.timeZone, args.now);
  const values = hashedValues(formatM06Values(metrics), args.orderDetailsComplete !== false);
  const hash = metricsHash(values);
  const contact = await args.client.getContact(args.contactId);
  if (readContactField(contact, "metrics_hash", ids) === hash) {
    return { written: false, hash, reason: "unchanged" };
  }
  const updatedAt = businessDateString(args.now, args.timeZone) ?? "";
  const payload: Record<string, string> = {
    ...values,
    metrics_hash: hash,
    m06_intelligence_updated_at: updatedAt,
  };
  const keysToWrite = M06_WRITTEN_KEYS.filter((key) => {
    if (!(key in payload)) return false;
    return !BLANK_OMIT.has(key) || (payload[key] ?? "") !== "";
  });
  await args.client.updateContact(
    args.contactId,
    keysToWrite.map((key) => ({
      id: requireFieldId(ids, key),
      key,
      value: payload[key] ?? "",
    })),
  );
  return { written: true, hash, reason: "updated" };
}

function hashedValues(values: Record<string, string>, orderDetailsComplete: boolean): Record<string, string> {
  if (orderDetailsComplete) return values;
  const hashed: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!DETAIL_KEYS.has(key)) hashed[key] = value;
  }
  return hashed;
}
