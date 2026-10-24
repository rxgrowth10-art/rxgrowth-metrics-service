import type { GhlClient } from "../ghl/index.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { computeM06, type MetricOrder } from "../metrics/index.js";
import { M06_WRITTEN_KEYS } from "../schema/fields.js";
import { businessDateString } from "../time/business-date.js";
import { invalidateFieldCache, isUnknownFieldError, loadFieldIdMap, refreshFieldIdMap } from "./field-cache.js";
import { buildFieldIdMap, readContactField, requireFieldId } from "./fields.js";
import { formatM06Values } from "./format.js";
import { metricsHash } from "./hash.js";

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
  },
  ids: ReadonlyMap<string, string>,
): Promise<WriteM06Result> {
  const metrics = computeM06(args.orders, args.timeZone, args.now);
  const values = formatM06Values(metrics);
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
  const keysToWrite = M06_WRITTEN_KEYS.filter(
    (key) => key !== "last_order_type" || (payload.last_order_type ?? "") !== "",
  );
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
