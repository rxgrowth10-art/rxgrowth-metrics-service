import type { GhlClient } from "../ghl/index.js";
import { hydrateOrders } from "../ghl/hydrate-orders.js";
import { applyLatestOrderDetail } from "../ghl/latest-order-detail.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import { computeM06 } from "../metrics/index.js";
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
}

export async function recomputeM06Contact(args: {
  client: GhlClient;
  contactId: string;
  locationId: string;
  timeZone: string;
  now: Date;
  idempotency: IdempotencyStore;
}): Promise<M06RecomputeResult> {
  const listed = await args.client.listOrders(args.contactId);
  const hydrated = await hydrateOrders(listed, (orderId) => args.client.getOrder(orderId));
  const orders = await applyLatestOrderDetail(hydrated, (orderId) => args.client.getOrder(orderId));
  const values = formatM06Values(computeM06(orders, args.timeZone, args.now));
  const result = await writeM06Metrics({
    client: args.client,
    contactId: args.contactId,
    orders,
    timeZone: args.timeZone,
    now: args.now,
    fieldCache: { store: args.idempotency, locationId: args.locationId },
  });
  return { written: result.written, values };
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
}): Promise<{ status: "locked" | "written" | "unchanged" | "failed"; values?: Record<string, string> }> {
  const lockKey = contactLockKey(args.locationId, args.contactId);
  const rerunKey = contactRerunKey(args.locationId, args.contactId);
  if (!(await args.idempotency.setNx(lockKey, CONTACT_LOCK_TTL_SECONDS))) {
    await args.idempotency.set(rerunKey, "1", CONTACT_RERUN_TTL_SECONDS);
    log("info", "m06.reconcile_locked", { locationId: args.locationId, contactId: args.contactId });
    return { status: "locked" };
  }
  let outcome: { status: "written" | "unchanged" | "failed"; values?: Record<string, string> } = { status: "failed" };
  try {
    const result = await recomputeM06Contact(args);
    outcome = { status: result.written ? "written" : "unchanged", values: result.values };
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
        outcome = { status: again.written ? "written" : "unchanged", values: again.values };
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
