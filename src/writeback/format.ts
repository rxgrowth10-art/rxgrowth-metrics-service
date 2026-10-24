import type { CustomerMetrics } from "../metrics";
import { fieldByKey } from "../schema/fields";

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
  };
}

export function coerceLastOrderType(value: string | null): string {
  if (!value || !value.trim()) return "";
  const normalized = value.trim().toLowerCase();
  const options = fieldByKey("last_order_type")?.picklistOptions ?? [];
  const direct = options.find((option) => option.toLowerCase() === normalized);
  if (direct) return direct;
  const alias = LAST_ORDER_TYPE_ALIASES[normalized];
  if (!alias) return "";
  return options.find((option) => option.toLowerCase() === alias.toLowerCase()) ?? "";
}

const LAST_ORDER_TYPE_ALIASES: Record<string, string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  "dine-in": "Dine-in",
  dine_in: "Dine-in",
  dinein: "Dine-in",
};

function decimal(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

function integer(value: number | null): string {
  return value === null ? "" : String(Math.trunc(value));
}

function text(value: string | null): string {
  return value ?? "";
}
