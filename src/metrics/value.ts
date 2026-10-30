import type { CustomerMetrics } from "./types.js";
import { round2 } from "./round.js";

/** Approved weights: spend 40, frequency 25, recency 20, consistency 15. */
export const SPEND_WEIGHT = 0.4;
export const FREQUENCY_WEIGHT = 0.25;
export const RECENCY_WEIGHT = 0.2;
export const CONSISTENCY_WEIGHT = 0.15;

/** VIP requires a value-score percentile at or above this cut. */
export const VIP_PERCENTILE = 90;

/** Fewer ranked customers than this, and nobody is VIP. */
export const VIP_MIN_CUSTOMERS = 10;

/** Emerging VIP also needs a value score at or above this. */
export const EMERGING_VIP_MIN_SCORE = 65;

export const M06_VALUE_FIELD_KEYS = [
  "lifetime_spend_percentile",
  "order_frequency_percentile",
  "customer_value_score",
  "vip_classification",
  "vip_status",
] as const;

export type M06ValueFieldKey = (typeof M06_VALUE_FIELD_KEYS)[number];

/**
 * Previous night's ranked customers. Parallel arrays, sorted ascending.
 * No contact ids.
 */
export interface ValueDistribution {
  readonly spend: readonly number[];
  readonly orders: readonly number[];
  readonly scores: readonly number[];
}

export interface ValueSample {
  spend: number;
  orders: number;
  /** Recency points already mapped from tenant-timezone days. */
  recency: number;
  /** Consistency points already mapped from the stored label. */
  consistency: number;
}

const CONSISTENCY_SCORE: Readonly<Record<string, number>> = {
  "Highly Consistent": 100,
  Consistent: 75,
  Variable: 50,
  Sporadic: 25,
  "Insufficient Data": 0,
};

/**
 * Percent rank: `(count ≤ value − 1) / (n − 1) × 100`.
 * n ≤ 1 is 100. A value below every stored point clamps to 0.
 * Rounded to two decimals.
 */
export function percentileRank(value: number, values: readonly number[]): number {
  const sorted = values.filter((item) => Number.isFinite(item)).sort((left, right) => left - right);
  return percentileRankSorted(value, sorted);
}

function percentileRankSorted(value: number, sorted: readonly number[]): number {
  if (sorted.length <= 1) return 100;
  const lessOrEqual = countAtMost(sorted, value);
  const raw = ((lessOrEqual - 1) / (sorted.length - 1)) * 100;
  return round2(Math.min(100, Math.max(0, raw)));
}

/** Last 30 days 100, 60 → 75, 90 → 50, 180 → 25, older or unknown → 0. */
export function recencyScore(days: number | null): number {
  if (days === null || !Number.isFinite(days)) return 0;
  if (days <= 30) return 100;
  if (days <= 60) return 75;
  if (days <= 90) return 50;
  if (days <= 180) return 25;
  return 0;
}

/** Stored purchase-consistency label. Anything else, including a missing label, is 0. */
export function consistencyScore(label: string | null): number {
  if (!label) return 0;
  return CONSISTENCY_SCORE[label] ?? 0;
}

export function customerValueScore(parts: {
  spendPercentile: number;
  frequencyPercentile: number;
  recency: number;
  consistency: number;
}): number {
  return round2(
    SPEND_WEIGHT * parts.spendPercentile +
      FREQUENCY_WEIGHT * parts.frequencyPercentile +
      RECENCY_WEIGHT * parts.recency +
      CONSISTENCY_WEIGHT * parts.consistency,
  );
}

export function buildValueDistribution(samples: readonly ValueSample[]): ValueDistribution {
  const spend = samples.map((sample) => sample.spend).sort(ascending);
  const orders = samples.map((sample) => sample.orders).sort(ascending);
  const scores = samples
    .map((sample) =>
      customerValueScore({
        spendPercentile: percentileRankSorted(sample.spend, spend),
        frequencyPercentile: percentileRankSorted(sample.orders, orders),
        recency: sample.recency,
        consistency: sample.consistency,
      }),
    )
    .sort(ascending);
  return { spend, orders, scores };
}

export function isVip(score: number, distribution: ValueDistribution): boolean {
  if (distribution.scores.length < VIP_MIN_CUSTOMERS) return false;
  return percentileRank(score, distribution.scores) >= VIP_PERCENTILE;
}

/**
 * Subtype for a contact who already cleared the value-score VIP cut.
 * Emerging VIP also needs a score of at least 65, an Increasing
 * order-frequency trend, and customer status Active or New.
 * Anyone else who is not a spend or frequency leader is Not VIP.
 */
export function vipClassification(args: {
  vip: boolean;
  spendPercentile: number;
  frequencyPercentile: number;
  score: number;
  orderFrequencyTrend: string;
  customerStatus: string;
}): string {
  if (!args.vip) return "Not VIP";
  const spend = args.spendPercentile >= VIP_PERCENTILE;
  const frequency = args.frequencyPercentile >= VIP_PERCENTILE;
  if (spend && frequency) return "High Value & High Frequency";
  if (spend) return "Spend Leader";
  if (frequency) return "Frequency Leader";
  if (isEmergingVip(args)) return "Emerging VIP";
  return "Not VIP";
}

function isEmergingVip(args: {
  score: number;
  orderFrequencyTrend: string;
  customerStatus: string;
}): boolean {
  return (
    args.score >= EMERGING_VIP_MIN_SCORE &&
    args.orderFrequencyTrend === "Increasing" &&
    (args.customerStatus === "Active" || args.customerStatus === "New")
  );
}

/**
 * Null when no distribution has been stored: the caller leaves the keys off
 * the update and out of the hash. A ranked contact gets the five values.
 * A contact with no qualifying orders gets blanks.
 */
export function valueFieldValues(
  metrics: CustomerMetrics,
  distribution: ValueDistribution | null,
): Record<M06ValueFieldKey, string> | null {
  if (!distribution) return null;
  if (metrics.qualifyingOrderCount <= 0) {
    return {
      lifetime_spend_percentile: "",
      order_frequency_percentile: "",
      customer_value_score: "",
      vip_classification: "",
      vip_status: "",
    };
  }
  const spendPercentile = percentileRank(metrics.lifetimeValue, distribution.spend);
  const frequencyPercentile = percentileRank(metrics.qualifyingOrderCount, distribution.orders);
  const score = customerValueScore({
    spendPercentile,
    frequencyPercentile,
    recency: recencyScore(metrics.daysSinceLastOrder),
    consistency: consistencyScore(metrics.purchaseConsistency),
  });
  const vip = isVip(score, distribution);
  return {
    lifetime_spend_percentile: spendPercentile.toFixed(2),
    order_frequency_percentile: frequencyPercentile.toFixed(2),
    customer_value_score: score.toFixed(2),
    vip_classification: vipClassification({
      vip,
      spendPercentile,
      frequencyPercentile,
      score,
      orderFrequencyTrend: metrics.orderFrequencyTrend,
      customerStatus: metrics.customerStatus,
    }),
    vip_status: vip ? "VIP" : "Not VIP",
  };
}

export function parseValueDistribution(raw: string): ValueDistribution | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  if (body.v !== 1) return null;
  const spend = finiteArray(body.spend);
  const orders = finiteArray(body.orders);
  const scores = finiteArray(body.scores);
  if (!spend || !orders || !scores) return null;
  if (spend.length !== orders.length || spend.length !== scores.length) return null;
  return {
    spend: [...spend].sort(ascending),
    orders: [...orders].sort(ascending),
    scores: [...scores].sort(ascending),
  };
}

export function serializeValueDistribution(distribution: ValueDistribution): string {
  return JSON.stringify({
    v: 1,
    spend: distribution.spend,
    orders: distribution.orders,
    scores: distribution.scores,
  });
}

function finiteArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    numbers.push(item);
  }
  return numbers;
}

function countAtMost(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const current = sorted[mid];
    if (current !== undefined && current <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function ascending(left: number, right: number): number {
  return left - right;
}
