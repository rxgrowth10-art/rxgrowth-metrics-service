import { loadCollectionNames } from "../ghl/collections.js";
import type { GhlClient, GhlOrder } from "../ghl/index.js";
import { ORDER_DETAIL_CONCURRENCY, hydrateOrders } from "../ghl/hydrate-orders.js";
import { applyLatestOrderDetail } from "../ghl/latest-order-detail.js";
import type { OrderSummaryCache } from "../ghl/order-summary-cache.js";
import { WEBHOOK_DETAIL_FETCH_LIMIT, resolveOrderSummaries } from "../ghl/resolve-order-summaries.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import {
  collectCollectionIds,
  computeM06,
  contactOrderSummaries,
  isQualifyingOrder,
  type OrderDetailSummary,
} from "../metrics/index.js";
import { formatM06Values } from "./format.js";
import { writeM06Metrics } from "./m06.js";

export const CONTACT_LOCK_TTL_SECONDS = 30;
export const CONTACT_RERUN_TTL_SECONDS = 120;

export function contactLockKey(locationId: string, contactId: string): string {
  return `lock:${locationId}:${contactId}`;
}

export function contactRerunKey(locationId: string, contactId: string): string {
  return `rerun:${locationId}:${contactId}`;
}

export interface M06RecomputeResult {
  written: boolean;
  values: Record<string, string>;
  /** Orders for this contact, each carrying `detailSummary` when the cache resolved it. */
  orders: GhlOrder[];
  /** Aligned with `orders`. Null where the detail summary is missing. */
  summaries: Array<OrderDetailSummary | null>;
  /** True when item-derived fields should keep the contact's previous values. */
  incomplete: boolean;
}

export interface OrderSummaryPass {
  orderSummaries?: OrderSummaryCache;
  /** Extra detail reads for cache misses. Defaults to the webhook cap of 2. */
  summaryFetchLimit?: number;
  /** Reconcile sets this from the hop budget so a long warm can continue later. */
  shouldStop?: () => boolean;
}

export async function recomputeM06Contact(args: {
  client: GhlClient;
  contactId: string;
  locationId: string;
  timeZone: string;
  now: Date;
  idempotency: IdempotencyStore;
} & OrderSummaryPass): Promise<M06RecomputeResult> {
  const known = new Map<string, GhlOrder>();
  const attempted = new Set<string>();
  const loadDetail = async (orderId: string): Promise<GhlOrder | null> => {
    attempted.add(orderId);
    const detail = await args.client.getOrder(orderId);
    if (detail) known.set(orderId, detail.id ? detail : { ...detail, id: orderId });
    return detail;
  };
  const listed = await args.client.listOrders(args.contactId);
  const hydrated = await hydrateOrders(listed, loadDetail, ORDER_DETAIL_CONCURRENCY);
  const detailed = await applyLatestOrderDetail(hydrated, loadDetail);
  let orders = detailed;
  let summaries = contactOrderSummaries(detailed);
  let incomplete = false;
  if (args.orderSummaries) {
    const resolved = await resolveOrderSummaries({
      locationId: args.locationId,
      contactId: args.contactId,
      orders: detailed,
      cache: args.orderSummaries,
      getOrder: loadDetail,
      knownDetails: known,
      attemptedIds: attempted,
      maxFetches: args.summaryFetchLimit ?? WEBHOOK_DETAIL_FETCH_LIMIT,
      ...(args.shouldStop ? { shouldStop: args.shouldStop } : {}),
    });
    orders = resolved.orders;
    summaries = resolved.summaries;
    incomplete = resolved.incomplete;
  }
  const qualifyingCovered = orders
    .filter(isQualifyingOrder)
    .every((order) => order.detailSummary != null);
  const orderDetailsComplete = !args.orderSummaries || (!incomplete && qualifyingCovered);
  const collectionIds = orderDetailsComplete ? collectCollectionIds(orders) : [];
  const collections =
    collectionIds.length === 0
      ? { names: new Map<string, string | null>(), ok: true }
      : await loadCollectionNames({
          store: args.idempotency,
          client: args.client,
          locationId: args.locationId,
          ids: collectionIds,
        });
  const values = formatM06Values(
    computeM06(orders, args.timeZone, args.now, { collectionNames: collections.names }),
  );
  const result = await writeM06Metrics({
    client: args.client,
    contactId: args.contactId,
    orders,
    timeZone: args.timeZone,
    now: args.now,
    fieldCache: { store: args.idempotency, locationId: args.locationId },
    orderDetailsComplete,
    collectionNames: collections.names,
    categoriesResolved: collections.ok,
  });
  return { written: result.written, values, orders, summaries, incomplete };
}

/**
 * Same per-contact lock as the webhook. A busy lock records a rerun so the
 * holder computes again, and this caller does not start a second fetch.
 */
export async function runLockedM06(args: {
  client: GhlClient;
  contactId: string;
  locationId: string;
  timeZone: string;
  now: Date;
  idempotency: IdempotencyStore;
} & OrderSummaryPass): Promise<{
  status: "locked" | "written" | "unchanged" | "failed";
  values?: Record<string, string>;
  incomplete?: boolean;
}> {
  const lockKey = contactLockKey(args.locationId, args.contactId);
  const rerunKey = contactRerunKey(args.locationId, args.contactId);
  if (!(await args.idempotency.setNx(lockKey, CONTACT_LOCK_TTL_SECONDS))) {
    await args.idempotency.set(rerunKey, "1", CONTACT_RERUN_TTL_SECONDS);
    log("info", "m06.reconcile_locked", { locationId: args.locationId, contactId: args.contactId });
    return { status: "locked" };
  }
  let outcome: { status: "written" | "unchanged" | "failed"; values?: Record<string, string>; incomplete?: boolean } = {
    status: "failed",
  };
  try {
    const result = await recomputeM06Contact(args);
    outcome = { status: result.written ? "written" : "unchanged", values: result.values, incomplete: result.incomplete };
  } catch (error) {
    log("error", "m06.reconcile_failed", {
      locationId: args.locationId,
      contactId: args.contactId,
      message: error instanceof Error ? error.message : "unknown",
    });
    outcome = { status: "failed" };
  } finally {
    await args.idempotency.del(lockKey);
    if ((await args.idempotency.get(rerunKey)) && (await args.idempotency.setNx(lockKey, CONTACT_LOCK_TTL_SECONDS))) {
      try {
        await args.idempotency.del(rerunKey);
        const again = await recomputeM06Contact(args);
        outcome = { status: again.written ? "written" : "unchanged", values: again.values, incomplete: again.incomplete };
      } catch (error) {
        log("error", "m06.reconcile_failed", {
          locationId: args.locationId,
          contactId: args.contactId,
          message: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        await args.idempotency.del(lockKey);
      }
    }
  }
  return outcome;
}
