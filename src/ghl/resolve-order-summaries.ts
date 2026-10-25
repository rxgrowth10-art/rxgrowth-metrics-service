import { log } from "../log/logger.js";
import type { OrderDetailSummary } from "../metrics/types.js";
import { ORDER_DETAIL_CONCURRENCY, runWithConcurrency } from "./hydrate-orders.js";
import {
  ORDER_SUMMARY_MGET_CHUNK,
  ORDER_SUMMARY_TTL_SECONDS,
  orderBackfillKey,
  orderSummaryKey,
  parseStoredSummary,
  serializeOrderSummary,
  summaryFromDetail,
} from "./order-summary.js";
import type { OrderSummaryCache } from "./order-summary-cache.js";
import type { GhlOrder } from "./types.js";

/**
 * Upstash commands on the webhook path. The free tier counts each command.
 * A pipeline is one HTTP round trip and one SET command per key.
 *
 * Steady state, every summary cached:
 *   1 MGET, 0 SETs, 0 SADD = 1 command. 0 extra GHL detail calls.
 *   The latest-order detail GET already required for last_order_type still runs
 *   and is not an extra call. A cache hit is not rewritten.
 *
 * First sight of a contact with one order:
 *   1 MGET + 1 SET of the detail just fetched = 2 commands. 0 extra GHL calls.
 *
 * Misses beyond details already fetched this pass:
 *   1 MGET (one more MGET per 100 keys) + one SET per summary written
 *   + 1 SADD when any order is still missing.
 *   Extra GHL detail calls: at most {@link WEBHOOK_DETAIL_FETCH_LIMIT} (2).
 *   Example: 4 uncached orders, latest already fetched = 1 MGET + 3 SETs + 1 SADD
 *   = 5 commands and 2 extra GHL calls.
 *
 * 50 restaurants × ~40 nudges/day × 1 steady-state command × 30 days
 * ≈ 60,000 commands/month, inside the 500,000 free-tier budget.
 */
export const WEBHOOK_DETAIL_FETCH_LIMIT = 2;

export interface ResolveOrderSummariesResult {
  orders: GhlOrder[];
  summaries: Array<OrderDetailSummary | null>;
  incomplete: boolean;
}

export async function resolveOrderSummaries(args: {
  locationId: string;
  contactId: string;
  orders: readonly GhlOrder[];
  cache: OrderSummaryCache;
  getOrder: (orderId: string) => Promise<GhlOrder | null>;
  /** Details already fetched this pass, keyed by the list order id. */
  knownDetails?: ReadonlyMap<string, GhlOrder>;
  /** Order ids already sent to GHL this pass. Failures are not retried here. */
  attemptedIds?: ReadonlySet<string>;
  /** Webhook passes 2. Reconcile passes Infinity and stops on the hop budget. */
  maxFetches: number;
  shouldStop?: () => boolean;
}): Promise<ResolveOrderSummariesResult> {
  const orders = args.orders.map((order) => ({ ...order }));
  const cacheable = orders.filter((order): order is GhlOrder & { id: string } => Boolean(order.id));
  const stored = await readSummaries(args.cache, cacheable.map((order) => orderSummaryKey(args.locationId, order.id, order.updatedAt)));
  const summaries = new Map<string, OrderDetailSummary>();
  const misses: Array<GhlOrder & { id: string }> = [];
  cacheable.forEach((order, index) => {
    const parsed = parseStoredSummary(stored[index], order.id, order.updatedAt);
    if (parsed) summaries.set(order.id, parsed);
    else misses.push(order);
  });

  const known = args.knownDetails ?? new Map<string, GhlOrder>();
  const attempted = args.attemptedIds ?? new Set<string>();
  const writes: OrderDetailSummary[] = [];
  const pending: Array<GhlOrder & { id: string }> = [];
  const deferred: Array<GhlOrder & { id: string }> = [];

  for (const order of misses) {
    const detail = known.get(order.id);
    if (detail) {
      const summary = summaryFromDetail(order, detail);
      if (summary) {
        summaries.set(order.id, summary);
        writes.push(summary);
        continue;
      }
    }
    if (attempted.has(order.id)) {
      deferred.push(order);
      continue;
    }
    pending.push(order);
  }

  const queue: Array<GhlOrder & { id: string }> = [];
  for (const order of pending) {
    if (args.shouldStop?.() || queue.length >= args.maxFetches) {
      deferred.push(order);
      continue;
    }
    queue.push(order);
  }

  await runWithConcurrency(queue, ORDER_DETAIL_CONCURRENCY, async (order) => {
    if (args.shouldStop?.()) {
      deferred.push(order);
      return;
    }
    let detail: GhlOrder | null;
    try {
      detail = await args.getOrder(order.id);
    } catch {
      detail = null;
    }
    if (!detail) {
      log("warn", "m06.order_summary_detail_failed", { orderId: order.id, message: "order detail failed" });
      deferred.push(order);
      return;
    }
    const summary = summaryFromDetail(order, detail.id ? detail : { ...detail, id: order.id });
    if (!summary) {
      deferred.push(order);
      return;
    }
    summaries.set(order.id, summary);
    writes.push(summary);
  });

  if (writes.length > 0) {
    await args.cache.setMany(
      writes.map((summary) => ({
        key: orderSummaryKey(args.locationId, summary.orderId, summary.updatedAt),
        value: serializeOrderSummary(summary),
      })),
      ORDER_SUMMARY_TTL_SECONDS,
    );
  }

  const incomplete = deferred.length > 0;
  if (incomplete) {
    await args.cache.sadd(orderBackfillKey(args.locationId), args.contactId);
    log("info", "m06.order_summary_incomplete", {
      locationId: args.locationId,
      contactId: args.contactId,
      missing: deferred.length,
    });
  }

  const withSummaries = orders.map((order) => {
    if (!order.id) return { ...order, detailSummary: null };
    return { ...order, detailSummary: summaries.get(order.id) ?? null };
  });
  return {
    orders: withSummaries,
    summaries: withSummaries.map((order) => order.detailSummary ?? null),
    incomplete,
  };
}

async function readSummaries(cache: OrderSummaryCache, keys: readonly string[]): Promise<unknown[]> {
  if (keys.length === 0) return [];
  const values: unknown[] = [];
  for (let index = 0; index < keys.length; index += ORDER_SUMMARY_MGET_CHUNK) {
    const slice = keys.slice(index, index + ORDER_SUMMARY_MGET_CHUNK);
    const page = (await cache.mget(slice)).slice(0, slice.length);
    while (page.length < slice.length) page.push(null);
    values.push(...page);
  }
  return values;
}
