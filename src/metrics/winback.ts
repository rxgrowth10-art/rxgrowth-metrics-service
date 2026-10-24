import { round2 } from "./round.js";

export const MIN_QUALIFYING_ORDERS = 3;
export const MIN_DAYS_SINCE_LAST_ORDER = 21;
export const MIN_OVERDUE_RATIO = 1.5;
export const HIGH_TIER_RATIO = 2;

export interface WinbackInput {
  qualifyingOrderCount: number;
  daysSinceLastOrder: number | null;
  typicalOrderIntervalDays: number | null;
}

export interface WinbackDecision {
  eligible: boolean;
  eligibility: "Eligible" | "Not Eligible";
  tier: "High" | "Medium" | "None";
  overdueRatio: number | null;
}

/**
 * M10 calculator rule. Eligibility is not an M06 write.
 * Tier is High at ratio >= 2, otherwise Medium, and only when eligible.
 */
export function evaluateWinback(input: WinbackInput): WinbackDecision {
  const typical = input.typicalOrderIntervalDays;
  const days = input.daysSinceLastOrder;
  const hasTypical = typical !== null && Number.isFinite(typical) && typical > 0;
  const overdueRatio = days !== null && hasTypical ? round2(days / typical) : null;
  const eligible =
    Number.isFinite(input.qualifyingOrderCount) &&
    input.qualifyingOrderCount >= MIN_QUALIFYING_ORDERS &&
    days !== null &&
    days >= MIN_DAYS_SINCE_LAST_ORDER &&
    hasTypical &&
    overdueRatio !== null &&
    overdueRatio >= MIN_OVERDUE_RATIO;
  const tier = !eligible || overdueRatio === null ? "None" : overdueRatio >= HIGH_TIER_RATIO ? "High" : "Medium";
  return {
    eligible,
    eligibility: eligible ? "Eligible" : "Not Eligible",
    tier,
    overdueRatio,
  };
}
