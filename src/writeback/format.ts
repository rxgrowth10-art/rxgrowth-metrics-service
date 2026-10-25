import type { CustomerMetrics } from "../metrics/index.js";
import { fieldByKey } from "../schema/fields.js";

export function formatM06Values(metrics: CustomerMetrics): Record<string, string> {
  return {
    total_orders: integer(metrics.totalOrders),
    qualifying_order_count: integer(metrics.qualifyingOrderCount),
    first_order_date: text(metrics.firstOrderDate),
    last_order_date: text(metrics.lastOrderDate),
    lifetime_value: decimal(metrics.lifetimeValue),
    average_order_value: decimal(metrics.averageOrderValue),
    highest_order_value: decimal(metrics.highestOrderValue),
    lowest_order_value: decimal(metrics.lowestOrderValue),
    customer_type: metrics.customerType,
    customer_status: metrics.customerStatus,
    lifecycle_stage: metrics.lifecycleStage,
    last_order_location: text(metrics.lastOrderLocation),
    last_order_type: coerceLastOrderType(metrics.lastOrderType),
    average_order_interval_days: decimal(metrics.averageOrderIntervalDays),
    typical_order_interval_days: decimal(metrics.typicalOrderIntervalDays),
    orders_last_30_days: integer(metrics.ordersLast30Days),
    orders_previous_30_days: integer(metrics.ordersPrevious30Days),
    spend_last_30_days: decimal(metrics.spendLast30Days),
    spend_previous_30_days: decimal(metrics.spendPrevious30Days),
    order_frequency_trend: metrics.orderFrequencyTrend,
    spending_trend: metrics.spendingTrend,
    days_since_last_order: integer(metrics.daysSinceLastOrder),
    expected_next_order_date: text(metrics.expectedNextOrderDate),
    days_overdue: decimal(metrics.daysOverdue),
    overdue_ratio: decimal(metrics.overdueRatio),
    favorite_item: text(metrics.favoriteItem),
    top_items: text(metrics.topItems),
    preferred_order_type: coerceLastOrderType(metrics.preferredOrderType),
    preferred_location: text(metrics.preferredLocation),
    purchase_consistency: picklist("purchase_consistency", metrics.purchaseConsistency),
    order_source_mix: text(metrics.orderSourceMix),
    primary_order_source: picklist("primary_order_source", metrics.primaryOrderSource),
  };
}

/** Checkout `delivery.method` only. Shipping fees and payment names are not a type. */
export function coerceLastOrderType(value: string | null): string {
  if (!value || !value.trim()) return "";
  const alias = CHECKOUT_METHOD[value.trim().toLowerCase()];
  if (!alias) return "";
  const options = fieldByKey("last_order_type")?.picklistOptions ?? [];
  return options.find((option) => option.toLowerCase() === alias.toLowerCase()) ?? "";
}

const CHECKOUT_METHOD: Record<string, string> = {
  shipping: "Delivery",
  pickup: "Pickup",
};

function picklist(key: string, value: string | null): string {
  if (!value) return "";
  const options = fieldByKey(key)?.picklistOptions ?? [];
  return options.find((option) => option === value) ?? "";
}

function decimal(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

function integer(value: number | null): string {
  return value === null ? "" : String(Math.trunc(value));
}

function text(value: string | null): string {
  return value ?? "";
}
