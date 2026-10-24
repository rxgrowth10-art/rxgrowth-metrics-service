import type { GhlClient } from "../ghl";
import { computeM06, type MetricOrder } from "../metrics";
import { M06_WRITTEN_KEYS } from "../schema/fields";
import { businessDateString } from "../time/business-date";
import { buildFieldIdMap, readContactField, requireFieldId } from "./fields";
import { formatM06Values } from "./format";
import { metricsHash } from "./hash";

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
}): Promise<WriteM06Result> {
  const metrics = computeM06(args.orders, args.timeZone, args.now);
  const values = formatM06Values(metrics);
  const hash = metricsHash(values);
  const [customFields, contact] = await Promise.all([
    args.client.listCustomFields(),
    args.client.getContact(args.contactId),
  ]);
  const ids = buildFieldIdMap(customFields);
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
