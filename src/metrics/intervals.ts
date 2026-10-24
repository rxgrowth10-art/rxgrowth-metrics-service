import { businessDateString, calendarDayDifference } from "../time/business-date";
import { orderInstant } from "./qualifying";
import { median, mean, round2 } from "./round";
import type { MetricOrder } from "./types";

export function orderIntervalsDays(orders: readonly MetricOrder[], timeZone: string): number[] {
  const days = new Set<string>();
  for (const order of orders) {
    const instant = orderInstant(order);
    if (!instant) continue;
    const day = businessDateString(instant, timeZone);
    if (day) days.add(day);
  }
  const sorted = [...days].sort();
  const intervals: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (!current || !previous) continue;
    const diff = calendarDayDifference(current, previous);
    if (diff !== null && diff > 0) intervals.push(diff);
  }
  return intervals;
}

export function averageIntervalDays(intervals: readonly number[]): number | null {
  const value = mean(intervals);
  return value === null ? null : round2(value);
}

export function typicalIntervalDays(intervals: readonly number[]): number | null {
  const value = median(intervals);
  return value === null ? null : round2(value);
}
