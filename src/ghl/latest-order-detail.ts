import { log } from "../log/logger.js";
import { isQualifyingOrder, orderInstant } from "../metrics/qualifying.js";
import type { GhlOrder } from "./types.js";

/** Detail reads for markAsTest fallback. The happy path uses one call. */
export const MAX_LATEST_ORDER_DETAIL_CALLS = 3;

/**
 * After the list is filtered to qualifying orders, read checkout choice and
 * branch from the latest order's detail. `delivery.method` of `shipping` or
 * `pickup` is stored on that order, and so is the branch name when the detail
 * has one. A detail `markAsTest: true` drops that order and tries the next
 * latest, up to three calls. A failed detail omits the type and does not fail
 * the event. The detail body is never logged: it contains contactSnapshot.
 */
export async function applyLatestOrderDetail(
  orders: readonly GhlOrder[],
  getOrder: (orderId: string) => Promise<GhlOrder | null>,
): Promise<GhlOrder[]> {
  const next = orders.map((order) => ({ ...order }));
  const qualifying = next.filter(isQualifyingOrder).sort(latestFirst);
  let calls = 0;
  for (const order of qualifying) {
    if (calls >= MAX_LATEST_ORDER_DETAIL_CALLS) break;
    if (!order.id) {
      order.deliveryMethod = null;
      log("warn", "m06.latest_order_detail_failed", { message: "order detail failed" });
      break;
    }
    calls += 1;
    let detail: GhlOrder | null;
    try {
      detail = await getOrder(order.id);
    } catch {
      order.deliveryMethod = null;
      log("warn", "m06.latest_order_detail_failed", { orderId: order.id, message: "order detail failed" });
      break;
    }
    if (!detail) {
      order.deliveryMethod = null;
      log("warn", "m06.latest_order_detail_failed", { orderId: order.id, message: "order detail failed" });
      break;
    }
    if (detail.markAsTest === true) {
      order.markAsTest = true;
      order.deliveryMethod = null;
      continue;
    }
    order.deliveryMethod = detail.deliveryMethod;
    order.branchName = detail.branchName;
    break;
  }
  return next;
}

function latestFirst(left: GhlOrder, right: GhlOrder): number {
  const a = orderInstant(left)?.getTime();
  const b = orderInstant(right)?.getTime();
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}
