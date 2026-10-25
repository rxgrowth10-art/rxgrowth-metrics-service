import { orderInstant } from "./qualifying.js";
import type { MetricOrder } from "./types.js";

export interface RankStat {
  count: number;
  spend: number;
  lastMs: number;
}

/** Higher count, then higher spend, then the later timestamp. */
export function compareRank(left: RankStat, right: RankStat): number {
  if (left.count !== right.count) return right.count - left.count;
  if (left.spend !== right.spend) return right.spend - left.spend;
  if (left.lastMs === right.lastMs) return 0;
  return right.lastMs - left.lastMs;
}

export function orderSpend(order: MetricOrder): number {
  const amount = typeof order.amount === "number" ? order.amount : Number(order.amount);
  return Number.isFinite(amount) ? amount : 0;
}

export function orderTimeMs(order: MetricOrder): number {
  return orderInstant(order)?.getTime() ?? Number.NEGATIVE_INFINITY;
}
