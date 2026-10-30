import { orderLines } from "./items.js";
import { isQualifyingOrder } from "./qualifying.js";
import { compareRank, orderTimeMs } from "./rank.js";
import type { MetricOrder } from "./types.js";

export interface CategoryRanking {
  favoriteCategory: string | null;
  /** Up to five names, separated by ", ". */
  topCategories: string | null;
  /** Distinct named categories. Null when none were named. */
  categoryDiversity: number | null;
}

const TOP_CATEGORY_LIMIT = 5;

/**
 * Collection ids on qualifying orders. Unqualified orders are ignored.
 * The caller uses this list to decide whether the name cache must be read.
 */
export function collectCollectionIds(orders: readonly MetricOrder[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    if (!isQualifyingOrder(order)) continue;
    for (const item of orderLines(order)) {
      for (const id of item.collectionIds ?? []) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * Qualifying orders only. A line counts toward each distinct collection name
 * on that line. Quantity, then line spend, then the latest order date.
 * A line with no named collection is dropped. It is not "Uncategorized".
 * Favorite is the first name. Top categories are the first five, ", "-separated.
 * Diversity is the number of distinct names, or null when there are none.
 */
export function rankCategories(
  orders: readonly MetricOrder[],
  collectionNames: ReadonlyMap<string, string | null>,
): CategoryRanking {
  const stats = new Map<string, { name: string; qty: number; spend: number; lastMs: number }>();
  for (const order of orders) {
    const at = orderTimeMs(order);
    for (const item of orderLines(order)) {
      const names = namesForLine(item.collectionIds ?? [], collectionNames);
      if (names.length === 0) continue;
      for (const name of names) {
        const current = stats.get(name) ?? { name, qty: 0, spend: 0, lastMs: Number.NEGATIVE_INFINITY };
        current.qty += item.qty ?? 0;
        current.spend += item.spend ?? 0;
        if (at > current.lastMs) current.lastMs = at;
        stats.set(name, current);
      }
    }
  }
  const ranked = [...stats.values()].sort((left, right) =>
    compareRank(
      { count: left.qty, spend: left.spend, lastMs: left.lastMs },
      { count: right.qty, spend: right.spend, lastMs: right.lastMs },
    ),
  );
  const favoriteCategory = ranked[0]?.name ?? null;
  const topCategories =
    ranked
      .slice(0, TOP_CATEGORY_LIMIT)
      .map((category) => category.name)
      .filter((name) => name.length > 0)
      .join(", ") || null;
  return {
    favoriteCategory,
    topCategories,
    categoryDiversity: ranked.length > 0 ? ranked.length : null,
  };
}

/** Distinct non-empty names. An id missing from the map, or stored as null, is skipped. */
function namesForLine(collectionIds: readonly string[], collectionNames: ReadonlyMap<string, string | null>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of collectionIds) {
    const name = collectionNames.get(id);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
