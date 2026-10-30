export interface IntelligenceSummaryInput {
  restaurantName: string;
  customerStatus?: string | null;
  lifecycleStage?: string | null;
  behaviorProfile?: string | null;
  qualifyingOrderCount?: string | null;
  ordersLast30Days?: string | null;
  ordersPrevious30Days?: string | null;
  firstOrderDate?: string | null;
  lastOrderDate?: string | null;
  daysSinceLastOrder?: string | null;
  averageOrderIntervalDays?: string | null;
  typicalOrderIntervalDays?: string | null;
  lifetimeValue?: string | null;
  averageOrderValue?: string | null;
  highestOrderValue?: string | null;
  lowestOrderValue?: string | null;
  currency?: string | null;
  customerValueScore?: string | null;
  lifetimeSpendPercentile?: string | null;
  orderFrequencyPercentile?: string | null;
  vipStatus?: string | null;
  vipClassification?: string | null;
  purchaseConsistency?: string | null;
  favoriteItem?: string | null;
  topItems?: string | null;
  favoriteCategory?: string | null;
  topCategories?: string | null;
  categoryDiversity?: string | null;
  preferredOrderType?: string | null;
  preferredLocation?: string | null;
  primaryOrderSource?: string | null;
  orderSourceMix?: string | null;
  orderFrequencyTrend?: string | null;
  spendingTrend?: string | null;
}

/**
 * English multi-section text. Empty values are dropped, and a section with
 * no remaining lines is dropped. The same input always returns the same text.
 */
export function intelligenceSummary(input: IntelligenceSummaryInput): string {
  const name = clean(input.restaurantName);
  const header = [name, "Customer intelligence"].filter((line) => line.length > 0);
  const money = (value: string | null | undefined) => formatMoney(value, input.currency);
  const blocks = [
    header.join("\n"),
    section("Profile", [
      ["Status", input.customerStatus],
      ["Lifecycle", input.lifecycleStage],
      ["Behavior", input.behaviorProfile],
      ["Purchase consistency", input.purchaseConsistency],
    ]),
    section("Orders", [
      ["Qualifying orders", input.qualifyingOrderCount],
      ["Orders last 30 days", input.ordersLast30Days],
      ["Orders previous 30 days", input.ordersPrevious30Days],
      ["First order", input.firstOrderDate],
      ["Last order", input.lastOrderDate],
      ["Days since last order", input.daysSinceLastOrder],
      ["Average interval (days)", input.averageOrderIntervalDays],
      ["Typical interval (days)", input.typicalOrderIntervalDays],
    ]),
    section("Value", [
      ["Lifetime value", money(input.lifetimeValue)],
      ["Average order value", money(input.averageOrderValue)],
      ["Highest order value", money(input.highestOrderValue)],
      ["Lowest order value", money(input.lowestOrderValue)],
      ["Value score", input.customerValueScore],
      ["Spend percentile", input.lifetimeSpendPercentile],
      ["Frequency percentile", input.orderFrequencyPercentile],
      ["VIP status", input.vipStatus],
      ["VIP classification", input.vipClassification],
    ]),
    section("Preferences", [
      ["Favorite item", input.favoriteItem],
      ["Top items", input.topItems],
      ["Favorite category", input.favoriteCategory],
      ["Top categories", input.topCategories],
      ["Category diversity", input.categoryDiversity],
      ["Preferred order type", input.preferredOrderType],
      ["Preferred location", input.preferredLocation],
      ["Primary order source", input.primaryOrderSource],
      ["Order source mix", input.orderSourceMix],
    ]),
    section("Trends", [
      ["Order frequency trend", input.orderFrequencyTrend],
      ["Spending trend", input.spendingTrend],
    ]),
  ].filter((block) => block.length > 0);
  return blocks.join("\n\n");
}

function section(title: string, rows: ReadonlyArray<readonly [string, string | null | undefined]>): string {
  const lines = rows.flatMap(([label, value]) => {
    const text = clean(value);
    if (!text) return [];
    return [`${label}: ${text}`];
  });
  if (lines.length === 0) return "";
  return [title, ...lines].join("\n");
}

function formatMoney(value: string | null | undefined, currency: string | null | undefined): string | null {
  const amount = clean(value);
  if (!amount) return null;
  const unit = clean(currency);
  return unit ? `${amount} ${unit}` : amount;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
