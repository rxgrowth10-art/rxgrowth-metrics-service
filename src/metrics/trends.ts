import type { Trend } from "./types";

export function calculateTrend(
  recentValue: number,
  previousValue: number,
  recentCount: number,
  previousCount: number,
): Trend {
  if (recentCount < 1 || previousCount < 1) return "Insufficient Data";
  if (recentValue > previousValue) return "Increasing";
  if (recentValue < previousValue) return "Decreasing";
  return "Stable";
}
