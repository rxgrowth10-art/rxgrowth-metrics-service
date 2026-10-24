import { businessDateString } from "../time/business-date.js";
import { orderInstant } from "./qualifying.js";
import type { MetricOrder } from "./types.js";

export function trailing12MonthOrderCount(
  orders: readonly MetricOrder[],
  timeZone: string,
  today: string,
): number {
  const anchor = new Date(`${today}T00:00:00Z`);
  anchor.setUTCFullYear(anchor.getUTCFullYear() - 1);
  const start = anchor.toISOString().slice(0, 10);
  return orders.filter((order) => {
    const instant = orderInstant(order);
    if (!instant) return false;
    const day = businessDateString(instant, timeZone);
    return day !== null && day >= start && day <= today;
  }).length;
}

export function frequencyBucket(trailingCount: number): string {
  if (trailingCount === 0) return "No Orders";
  if (trailingCount === 1) return "First-Time";
  if (trailingCount <= 4) return "Repeat";
  if (trailingCount <= 9) return "Regular";
  return "Frequent";
}
