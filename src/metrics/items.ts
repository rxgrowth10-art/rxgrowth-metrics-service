import { compareRank, orderTimeMs } from "./rank.js";
import type { MetricOrder, OrderLine } from "./types.js";

export interface ItemRanking {
  favoriteItem: string | null;
  topItems: string | null;
}

const TOP_ITEM_LIMIT = 5;

/** Lines from the detail summary when this pass attached one, otherwise the order itself. */
export function orderLines(order: MetricOrder): readonly OrderLine[] {
  if (order.detailSummary) return order.detailSummary.items;
  return order.items ?? [];
}

/**
 * Qualifying orders only. Group by product id, then name. Rank by quantity,
 * then line spend (`price.amount × qty`), then the latest order date.
 * Favorite is the first name. Top items are the first five names, ", "-separated.
 */
export function rankFavoriteItems(orders: readonly MetricOrder[]): ItemRanking {
  const stats = new Map<string, { name: string | null; qty: number; spend: number; lastMs: number }>();
  for (const order of orders) {
    const at = orderTimeMs(order);
    for (const item of orderLines(order)) {
      const name = item.name;
      const id = item.productId;
      const key = id ?? name;
      if (!key) continue;
      const current = stats.get(key) ?? { name, qty: 0, spend: 0, lastMs: Number.NEGATIVE_INFINITY };
      current.qty += item.qty ?? 0;
      current.spend += item.spend ?? 0;
      if (at > current.lastMs) current.lastMs = at;
      stats.set(key, current);
    }
  }
  const ranked = [...stats.values()].sort((left, right) =>
    compareRank(
      { count: left.qty, spend: left.spend, lastMs: left.lastMs },
      { count: right.qty, spend: right.spend, lastMs: right.lastMs },
    ),
  );
  const favoriteItem = ranked[0]?.name ?? null;
  const topItems =
    ranked
      .slice(0, TOP_ITEM_LIMIT)
      .map((item) => item.name)
      .filter((name): name is string => Boolean(name))
      .join(", ") || null;
  return { favoriteItem, topItems };
}
