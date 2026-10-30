import type { GhlContact } from "../ghl/index.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import {
  buildValueDistribution,
  consistencyScore,
  parseValueDistribution,
  recencyScore,
  serializeValueDistribution,
  type ValueDistribution,
  type ValueSample,
} from "../metrics/value.js";
import { businessDateString, calendarDayDifference, parseStoredDate } from "../time/business-date.js";
import { readContactField } from "../writeback/fields.js";

/** Last completed scan. Long enough that one missed night still ranks. */
export const VALUE_DISTRIBUTION_TTL_SECONDS = 8 * 24 * 60 * 60;

/** Same window as the contact-search cursor. A finished scan deletes it. */
export const VALUE_DISTRIBUTION_BUILD_TTL_SECONDS = 2 * 60 * 60;

export function valueDistributionKey(locationId: string): string {
  return `m10:dist:${locationId}`;
}

export function valueDistributionBuildKey(locationId: string, day: string): string {
  return `m10:dist-build:${locationId}:${day}`;
}

export interface ValueBuild {
  searchAfter: readonly unknown[];
  samples: ValueSample[];
}

/**
 * One Redis GET. A missing, unreadable, or malformed key is "no distribution":
 * the webhook leaves the percentile and VIP keys off the update and the hash.
 */
export async function loadValueDistribution(
  store: IdempotencyStore,
  locationId: string,
): Promise<ValueDistribution | null> {
  try {
    const raw = await store.get(valueDistributionKey(locationId));
    if (!raw) return null;
    return parseValueDistribution(raw);
  } catch (error) {
    log("warn", "m10.distribution_read_failed", {
      locationId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function readValueBuild(
  store: IdempotencyStore,
  locationId: string,
  day: string,
): Promise<ValueBuild | null> {
  const raw = await store.get(valueDistributionBuildKey(locationId, day));
  if (!raw) return null;
  return parseValueBuild(raw);
}

export async function writeValueBuild(
  store: IdempotencyStore,
  locationId: string,
  day: string,
  searchAfter: readonly unknown[],
  samples: readonly ValueSample[],
): Promise<void> {
  await store.set(
    valueDistributionBuildKey(locationId, day),
    JSON.stringify({
      v: 1,
      searchAfter: [...searchAfter],
      spend: samples.map((sample) => sample.spend),
      orders: samples.map((sample) => sample.orders),
      recency: samples.map((sample) => sample.recency),
      consistency: samples.map((sample) => sample.consistency),
    }),
    VALUE_DISTRIBUTION_BUILD_TTL_SECONDS,
  );
}

export async function clearValueBuild(store: IdempotencyStore, locationId: string, day: string): Promise<void> {
  await store.del(valueDistributionBuildKey(locationId, day));
}

/**
 * Replaces the location distribution. The payload is numeric arrays only.
 */
export async function publishValueDistribution(
  store: IdempotencyStore,
  locationId: string,
  samples: readonly ValueSample[],
): Promise<void> {
  const distribution = buildValueDistribution(samples);
  await store.set(
    valueDistributionKey(locationId),
    serializeValueDistribution(distribution),
    VALUE_DISTRIBUTION_TTL_SECONDS,
  );
  log("info", "m10.distribution_published", { locationId, customers: distribution.scores.length });
}

/**
 * A ranked customer has a numeric lifetime value and a qualifying order count
 * above zero. Contacts M06 has not written yet stay out of the population.
 */
export function valueSampleFromContact(
  contact: GhlContact,
  ids: ReadonlyMap<string, string>,
  timeZone: string,
  now: Date,
): ValueSample | null {
  const countRaw = readContactField(contact, "qualifying_order_count", ids);
  const spendRaw = readContactField(contact, "lifetime_value", ids);
  if (countRaw === null || spendRaw === null) return null;
  const orders = Number(countRaw);
  const spend = Number(spendRaw);
  if (!Number.isFinite(orders) || !Number.isFinite(spend) || orders <= 0) return null;
  const lastOrderRaw = readContactField(contact, "last_order_date", ids);
  const today = businessDateString(now, timeZone);
  const lastOrder = lastOrderRaw ? parseStoredDate(lastOrderRaw, timeZone) : null;
  const days =
    lastOrder && today ? Math.max(0, calendarDayDifference(today, lastOrder) ?? 0) : null;
  return {
    spend,
    orders,
    recency: recencyScore(days),
    consistency: consistencyScore(readContactField(contact, "purchase_consistency", ids)),
  };
}

function parseValueBuild(raw: string): ValueBuild | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  if (body.v !== 1 || !Array.isArray(body.searchAfter)) return null;
  const spend = numberArray(body.spend);
  const orders = numberArray(body.orders);
  const recency = numberArray(body.recency);
  const consistency = numberArray(body.consistency);
  if (!spend || !orders || !recency || !consistency) return null;
  if (spend.length !== orders.length || spend.length !== recency.length || spend.length !== consistency.length) {
    return null;
  }
  const samples: ValueSample[] = spend.map((amount, index) => ({
    spend: amount,
    orders: orders[index] ?? 0,
    recency: recency[index] ?? 0,
    consistency: consistency[index] ?? 0,
  }));
  return { searchAfter: body.searchAfter, samples };
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    numbers.push(item);
  }
  return numbers;
}
