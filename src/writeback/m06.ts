import type { GhlClient } from "../ghl/index.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { computeM06, type MetricOrder } from "../metrics/index.js";
import { M06_VALUE_FIELD_KEYS, valueFieldValues, type ValueDistribution } from "../metrics/value.js";
import { M06_WRITTEN_KEYS } from "../schema/fields.js";
import { businessDateString } from "../time/business-date.js";
import { invalidateFieldCache, isUnknownFieldError, loadFieldIdMap, refreshFieldIdMap } from "./field-cache.js";
import { buildFieldIdMap, readContactField, requireFieldId } from "./fields.js";
import { formatM06Values } from "./format.js";
import { metricsHash } from "./hash.js";

/** Category keys. A failed collection-name refresh leaves these out even when order details are complete. */
export const M06_CATEGORY_FIELD_KEYS = [
  "favorite_category",
  "top_categories",
  "category_diversity",
] as const;

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
  ...M06_CATEGORY_FIELD_KEYS,
] as const;

const DETAIL_KEYS = new Set<string>(M06_DETAIL_FIELD_KEYS);
const CATEGORY_KEYS = new Set<string>(M06_CATEGORY_FIELD_KEYS);
const VALUE_KEYS = new Set<string>(M06_VALUE_FIELD_KEYS);
/**
 * Blank picklists stay in the hash as "" and are left off the contact update.
 * Percentile numbers are written as "" when the contact has no qualifying orders.
 */
const BLANK_OMIT = new Set([
  "last_order_type",
  "preferred_order_type",
  "primary_order_source",
  "vip_classification",
  "vip_status",
]);

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
  /** Collection id to name. Used only when category fields are included. */
  collectionNames?: ReadonlyMap<string, string | null>;
  /**
   * False when the collection-name refresh failed. The three category keys
   * stay off the contact and out of the hash. Defaults to true.
   */
  categoriesResolved?: boolean;
  /**
   * Previous night's distribution. Null or omitted leaves the percentile and
   * VIP keys off the contact and out of the hash.
   */
  valueDistribution?: ValueDistribution | null;
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
    collectionNames?: ReadonlyMap<string, string | null>;
    categoriesResolved?: boolean;
    valueDistribution?: ValueDistribution | null;
  },
  ids: ReadonlyMap<string, string>,
): Promise<WriteM06Result> {
  const metrics = computeM06(args.orders, args.timeZone, args.now, {
    collectionNames: args.collectionNames,
  });
  const valueFields = valueFieldValues(metrics, args.valueDistribution ?? null);
  const formatted = valueFields ? { ...formatM06Values(metrics), ...valueFields } : formatM06Values(metrics);
  const values = hashedValues(
    formatted,
    args.orderDetailsComplete !== false,
    args.categoriesResolved !== false,
    valueFields !== null,
  );
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

function hashedValues(
  values: Record<string, string>,
  orderDetailsComplete: boolean,
  categoriesResolved: boolean,
  valueDistributionReady: boolean,
): Record<string, string> {
  if (orderDetailsComplete && categoriesResolved && valueDistributionReady) return values;
  const hashed: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!orderDetailsComplete && DETAIL_KEYS.has(key)) continue;
    if (!categoriesResolved && CATEGORY_KEYS.has(key)) continue;
    if (!valueDistributionReady && VALUE_KEYS.has(key)) continue;
    hashed[key] = value;
  }
  return hashed;
}
