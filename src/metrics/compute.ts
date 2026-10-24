import { addCalendarDays, businessDateString, calendarDayDifference } from "../time/business-date";
import { frequencyBucket, trailing12MonthOrderCount } from "./frequency";
import { averageIntervalDays, orderIntervalsDays, typicalIntervalDays } from "./intervals";
import { customerStatus, customerType, lifecycleStage } from "./lifecycle";
import { summarizeValue } from "./ltv";
import { isQualifyingOrder, orderInstant } from "./qualifying";
import { recencyBucket } from "./recency";
import { round2 } from "./round";
import { calculateTrend } from "./trends";
import type { CustomerMetrics, MetricOrder } from "./types";

export function computeM06(orders: readonly MetricOrder[], timeZone: string, now: Date): CustomerMetrics {
  const qualifying = orders.filter(isQualifyingOrder);
  const sorted = [...qualifying].sort(compareOrderTime);
  const count = sorted.length;
  const today = businessDateString(now, timeZone);
  const intervals = orderIntervalsDays(sorted, timeZone);
  const averageOrderIntervalDays = averageIntervalDays(intervals);
  const typicalOrderIntervalDays = typicalIntervalDays(intervals);
  const values = summarizeValue(sorted);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstOrderDate = first ? businessDay(first, timeZone) : null;
  const lastOrderDate = last ? businessDay(last, timeZone) : null;
  const daysSinceLastOrder =
    lastOrderDate && today ? Math.max(0, calendarDayDifference(today, lastOrderDate) ?? 0) : null;
  const hasTypical = typicalOrderIntervalDays !== null && typicalOrderIntervalDays > 0;
  const daysOverdue =
    daysSinceLastOrder !== null && hasTypical
      ? round2(Math.max(0, daysSinceLastOrder - typicalOrderIntervalDays))
      : null;
  const overdueRatio =
    daysSinceLastOrder !== null && hasTypical ? round2(daysSinceLastOrder / typicalOrderIntervalDays) : null;
  const windows = today ? windowCounts(sorted, timeZone, today) : emptyWindows();
  const trailing = today ? trailing12MonthOrderCount(sorted, timeZone, today) : 0;

  return {
    qualifyingOrderCount: count,
    totalOrders: count,
    excludedOrderCount: orders.length - count,
    ...values,
    firstOrderDate,
    lastOrderDate,
    lastOrderType: last?.sourceSubType ?? null,
    lastOrderLocation: last?.sourceName ?? null,
    recencyDays: daysSinceLastOrder,
    recencyBucket: daysSinceLastOrder === null ? null : recencyBucket(daysSinceLastOrder),
    trailing12MonthOrderCount: trailing,
    frequencyBucket: frequencyBucket(trailing),
    ordersLast30Days: windows.ordersLast30Days,
    ordersPrevious30Days: windows.ordersPrevious30Days,
    spendLast30Days: windows.spendLast30Days,
    spendPrevious30Days: windows.spendPrevious30Days,
    orderFrequencyTrend: calculateTrend(
      windows.ordersLast30Days,
      windows.ordersPrevious30Days,
      windows.ordersLast30Days,
      windows.ordersPrevious30Days,
    ),
    spendingTrend: calculateTrend(
      windows.spendLast30Days,
      windows.spendPrevious30Days,
      windows.ordersLast30Days,
      windows.ordersPrevious30Days,
    ),
    orderIntervalsDays: intervals,
    averageOrderIntervalDays,
    typicalOrderIntervalDays,
    daysSinceLastOrder,
    expectedNextOrderDate:
      lastOrderDate && hasTypical ? addCalendarDays(lastOrderDate, Math.round(typicalOrderIntervalDays)) : null,
    daysOverdue,
    overdueRatio,
    lifecycleStage: lifecycleStage(count, daysSinceLastOrder),
    customerType: customerType(count),
    customerStatus: customerStatus(count, daysSinceLastOrder),
  };
}

function compareOrderTime(left: MetricOrder, right: MetricOrder): number {
  const a = orderInstant(left)?.getTime();
  const b = orderInstant(right)?.getTime();
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

function businessDay(order: MetricOrder, timeZone: string): string | null {
  const instant = orderInstant(order);
  return instant ? businessDateString(instant, timeZone) : null;
}

interface Windows {
  ordersLast30Days: number;
  ordersPrevious30Days: number;
  spendLast30Days: number;
  spendPrevious30Days: number;
}

function emptyWindows(): Windows {
  return { ordersLast30Days: 0, ordersPrevious30Days: 0, spendLast30Days: 0, spendPrevious30Days: 0 };
}

function windowCounts(orders: readonly MetricOrder[], timeZone: string, today: string): Windows {
  const windows = emptyWindows();
  for (const order of orders) {
    const day = businessDay(order, timeZone);
    if (!day) continue;
    const age = calendarDayDifference(today, day);
    if (age === null || age < 0) continue;
    const amount = Number(order.amount);
    if (age <= 30) {
      windows.ordersLast30Days += 1;
      if (Number.isFinite(amount)) windows.spendLast30Days += amount;
    } else if (age <= 60) {
      windows.ordersPrevious30Days += 1;
      if (Number.isFinite(amount)) windows.spendPrevious30Days += amount;
    }
  }
  windows.spendLast30Days = round2(windows.spendLast30Days);
  windows.spendPrevious30Days = round2(windows.spendPrevious30Days);
  return windows;
}
