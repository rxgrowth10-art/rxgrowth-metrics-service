import { resolveLastOrderLocation } from "./location.js";
import { compareRank, orderSpend, orderTimeMs } from "./rank.js";
import type { MetricOrder } from "./types.js";

const CHECKOUT_METHOD = new Set(["shipping", "pickup"]);

const SOURCE_LABELS: Record<string, string> = {
  website: "Online Store",
  funnel: "Online Store",
  store: "Online Store",
  pos: "POS",
  manual: "Manual",
  invoice: "Manual",
  import: "Imported",
  imported: "Imported",
};

/** Source type, subtype, or name tokens that are delivery-platform integrations. */
const DELIVERY_TOKENS = new Set([
  "talabat",
  "elmenus",
  "elmenu",
  "hungerstation",
  "jahez",
  "instashop",
  "mrsool",
  "careem",
  "noonfood",
  "toyou",
  "snoonu",
  "deliveroo",
  "ubereats",
  "doordash",
  "grubhub",
  "justeat",
  "glovo",
  "wolt",
  "foodpanda",
  "delivery",
]);

export interface ChannelRanking {
  /** Raw checkout method, `shipping` or `pickup`, before the Delivery/Pickup label. */
  preferredOrderType: string | null;
  preferredLocation: string | null;
  orderSourceMix: string | null;
  /** Picklist label. Null when there is no qualifying order to classify. */
  primaryOrderSource: string | null;
}

export function orderCheckoutMethod(order: MetricOrder): string | null {
  if (order.detailSummary) return order.detailSummary.deliveryMethod;
  return order.deliveryMethod ?? null;
}

/** Same branch-then-source rule as last order location, per order. */
export function orderLocationName(order: MetricOrder): string | null {
  const summary = order.detailSummary;
  if (summary) return summary.branchName ?? summary.sourceName ?? order.sourceName ?? null;
  return resolveLastOrderLocation(order);
}

export function classifyOrderSource(order: MetricOrder): string {
  return (
    sourceLabel(order.sourceType) ??
    sourceLabel(order.sourceSubType) ??
    sourceLabel(order.sourceName) ??
    "Other"
  );
}

/**
 * Qualifying orders only. Preferred type and location count known values and
 * break ties by order count, spend, then latest date. The mix is
 * `source name: count` in that same order. Primary source is the winning
 * mapped category, not the raw source name.
 */
export function rankChannels(orders: readonly MetricOrder[]): ChannelRanking {
  return {
    preferredOrderType: mode(orders, checkoutKey),
    preferredLocation: mode(orders, orderLocationName),
    orderSourceMix: mix(orders),
    primaryOrderSource: orders.length === 0 ? null : mode(orders, classifyOrderSource),
  };
}

function mode(orders: readonly MetricOrder[], read: (order: MetricOrder) => string | null): string | null {
  const stats = new Map<string, { count: number; spend: number; lastMs: number }>();
  for (const order of orders) {
    const key = read(order);
    if (!key) continue;
    const current = stats.get(key) ?? { count: 0, spend: 0, lastMs: Number.NEGATIVE_INFINITY };
    current.count += 1;
    current.spend += orderSpend(order);
    current.lastMs = Math.max(current.lastMs, orderTimeMs(order));
    stats.set(key, current);
  }
  const ranked = [...stats.entries()].sort((left, right) => compareRank(left[1], right[1]));
  return ranked[0]?.[0] ?? null;
}

function mix(orders: readonly MetricOrder[]): string | null {
  const stats = new Map<string, { count: number; spend: number; lastMs: number }>();
  for (const order of orders) {
    const name = order.sourceName;
    if (!name || name.trim() === "") continue;
    const current = stats.get(name) ?? { count: 0, spend: 0, lastMs: Number.NEGATIVE_INFINITY };
    current.count += 1;
    current.spend += orderSpend(order);
    current.lastMs = Math.max(current.lastMs, orderTimeMs(order));
    stats.set(name, current);
  }
  const ranked = [...stats.entries()].sort((left, right) => compareRank(left[1], right[1]));
  if (ranked.length === 0) return null;
  return ranked.map(([name, stat]) => `${name}: ${stat.count}`).join(", ");
}

function checkoutKey(order: MetricOrder): string | null {
  const method = orderCheckoutMethod(order)?.trim().toLowerCase() ?? "";
  return CHECKOUT_METHOD.has(method) ? method : null;
}

function sourceLabel(value: string | null | undefined): string | null {
  const token = normalizeToken(value);
  if (!token) return null;
  return SOURCE_LABELS[token] ?? (DELIVERY_TOKENS.has(token) ? "Delivery Platform" : null);
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}
