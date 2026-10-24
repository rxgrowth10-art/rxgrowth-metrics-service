import { parseInstant } from "../time/business-date";
import type { MetricOrder } from "./types";

const QUALIFYING_PAYMENT_STATUSES = new Set(["paid", "unpaid", "partially_paid"]);
const EXCLUDED_ORDER_STATUSES = new Set(["cancelled", "refunded", "partially_refunded"]);

/**
 * Locked qualifying rule. Payment status is required: COD arrives as `unpaid`
 * and qualifies; `refunded` and `partially_refunded` do not. Order status
 * also excludes `cancelled`, `refunded`, and `partially_refunded`.
 * Fulfillment status is ignored. A missing markAsTest means the order is not a test order.
 */
export function isQualifyingOrder(order: MetricOrder | null | undefined): boolean {
  if (!order) return false;
  if (order.liveMode !== true) return false;
  if (order.markAsTest === true) return false;
  const amount = typeof order.amount === "number" ? order.amount : Number(order.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (EXCLUDED_ORDER_STATUSES.has((order.status ?? "").trim().toLowerCase())) return false;
  const paymentStatus = (order.paymentStatus ?? "").trim().toLowerCase();
  return QUALIFYING_PAYMENT_STATUSES.has(paymentStatus);
}

export function orderInstant(order: MetricOrder): Date | null {
  return parseInstant(order.createdAt) ?? parseInstant(order.updatedAt);
}
