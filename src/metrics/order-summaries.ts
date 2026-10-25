import type { MetricOrder, OrderDetailSummary } from "./types.js";

/** Per-order summaries aligned with `orders`. A miss is null. */
export interface ContactOrderView {
  orders: readonly MetricOrder[];
  summaries: readonly (OrderDetailSummary | null)[];
  /** True when this pass left at least one order detail unfetched. */
  incomplete: boolean;
}

/**
 * Pure view of the summaries already attached to a contact's orders.
 * Later field calculations read this. It does not fetch or write.
 */
export function contactOrderSummaries(orders: readonly MetricOrder[]): Array<OrderDetailSummary | null> {
  return orders.map((order) => order.detailSummary ?? null);
}

export function viewContactOrders(orders: readonly MetricOrder[], incomplete = false): ContactOrderView {
  return { orders, summaries: contactOrderSummaries(orders), incomplete };
}
