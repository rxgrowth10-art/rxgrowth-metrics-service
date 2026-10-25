import type { GhlOrder } from "./types.js";
import type { OrderDetailSummary, OrderLine } from "../metrics/types.js";

/** 180 days. `updatedAt` is part of the key, so an edit stores a new entry. */
export const ORDER_SUMMARY_TTL_SECONDS = 180 * 24 * 60 * 60;

/** One MGET stays one command until a contact has more orders than this. */
export const ORDER_SUMMARY_MGET_CHUNK = 100;

const SUMMARY_FIELDS = [
  "items",
  "deliveryMethod",
  "sourceType",
  "sourceSubType",
  "sourceName",
  "couponCode",
  "branchName",
] as const;

export function orderSummaryKey(locationId: string, orderId: string, updatedAt: string | null | undefined): string {
  const version = updatedAt && updatedAt.length > 0 ? updatedAt : "none";
  return `m06:od:${locationId}:${orderId}:${version}`;
}

export function orderBackfillKey(locationId: string): string {
  return `m06:backfill:${locationId}`;
}

/**
 * Summary of a detail we already hold. The key version is the list order's
 * `updatedAt`, which is what the next webhook will look up.
 */
export function summaryFromDetail(listed: GhlOrder, detail: GhlOrder): OrderDetailSummary | null {
  const orderId = listed.id ?? detail.id;
  if (!orderId) return null;
  return {
    orderId,
    updatedAt: listed.updatedAt,
    items: detail.items.length > 0 ? detail.items : listed.items,
    deliveryMethod: detail.deliveryMethod ?? listed.deliveryMethod,
    sourceType: detail.sourceType ?? listed.sourceType,
    sourceSubType: detail.sourceSubType ?? listed.sourceSubType,
    sourceName: detail.sourceName ?? listed.sourceName,
    couponCode: detail.couponCode ?? listed.couponCode,
    branchName: detail.branchName ?? listed.branchName,
  };
}

/** Allowlisted JSON. Customer fields cannot appear because they are not copied. */
export function serializeOrderSummary(summary: OrderDetailSummary): string {
  return JSON.stringify({
    items: summary.items.map(serializeLine),
    deliveryMethod: summary.deliveryMethod,
    sourceType: summary.sourceType,
    sourceSubType: summary.sourceSubType,
    sourceName: summary.sourceName,
    couponCode: summary.couponCode,
    branchName: summary.branchName,
  });
}

export function summaryFieldNames(): readonly string[] {
  return SUMMARY_FIELDS;
}

export function parseStoredSummary(
  raw: unknown,
  orderId: string,
  updatedAt: string | null,
): OrderDetailSummary | null {
  const record = asStoredRecord(raw);
  if (!record) return null;
  return {
    orderId,
    updatedAt,
    items: parseStoredItems(record.items),
    deliveryMethod: asStoredString(record.deliveryMethod),
    sourceType: asStoredString(record.sourceType),
    sourceSubType: asStoredString(record.sourceSubType),
    sourceName: asStoredString(record.sourceName),
    couponCode: asStoredString(record.couponCode),
    branchName: asStoredString(record.branchName),
  };
}

function serializeLine(item: OrderLine): OrderLine {
  return {
    productId: item.productId,
    name: item.name,
    qty: item.qty,
    spend: item.spend,
    collectionIds: [...item.collectionIds],
  };
}

function asStoredRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return asStoredRecord(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parseStoredItems(value: unknown): OrderLine[] {
  if (!Array.isArray(value)) return [];
  const items: OrderLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    items.push({
      productId: asStoredString(record.productId),
      name: asStoredString(record.name),
      qty: asStoredNumber(record.qty),
      spend: asStoredNumber(record.spend),
      collectionIds: asStoredIds(record.collectionIds),
    });
  }
  return items;
}

function asStoredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStoredNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStoredIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
