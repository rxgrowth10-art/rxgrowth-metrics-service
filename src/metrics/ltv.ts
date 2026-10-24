import { round2 } from "./round.js";
import type { MetricOrder } from "./types.js";

export interface ValueSummary {
  lifetimeValue: number;
  averageOrderValue: number;
  highestOrderValue: number | null;
  lowestOrderValue: number | null;
}

export function summarizeValue(orders: readonly MetricOrder[]): ValueSummary {
  if (orders.length === 0) {
    return {
      lifetimeValue: 0,
      averageOrderValue: 0,
      highestOrderValue: null,
      lowestOrderValue: null,
    };
  }
  const amounts = orders
    .map((order) => Number(order.amount))
    .filter((amount) => Number.isFinite(amount));
  const lifetimeValue = round2(amounts.reduce((sum, amount) => sum + amount, 0));
  let highest: number | null = null;
  let lowest: number | null = null;
  for (const amount of amounts) {
    highest = highest === null ? amount : Math.max(highest, amount);
    lowest = lowest === null ? amount : Math.min(lowest, amount);
  }
  return {
    lifetimeValue,
    averageOrderValue: round2(lifetimeValue / orders.length),
    highestOrderValue: highest === null ? null : round2(highest),
    lowestOrderValue: lowest === null ? null : round2(lowest),
  };
}
