import type { MetricOrder } from "./types";

const QUALIFYING_PAYMENT_STATUSES = new Set(["paid", "unpaid", "partially_paid"]);

/**
 * Locked qualifying rule. Payment status is required: COD arrives as `unpaid`
 * and qualifies; `refunded` and `partially_refunded` do not. Order status
 * disqualifies only `cancelled`. Fulfillment status is ignored.
 */
export function isQualifyingOrder(order: MetricOrder | null | undefined): boolean {
  if (!order) return false;
  if (order.liveMode !== true) return false;
  if (order.markAsTest === true) return false;
  const amount = typeof order.amount === "number" ? order.amount : Number(order.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if ((order.status ?? "").trim().toLowerCase() === "cancelled") return false;
  const paymentStatus = (order.paymentStatus ?? "").trim().toLowerCase();
  return QUALIFYING_PAYMENT_STATUSES.has(paymentStatus);
}

export function orderInstant(order: MetricOrder): Date | null {
  const raw = order.createdAt || order.updatedAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
