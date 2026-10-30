import { fieldByKey } from "../schema/fields.js";

/** Qualifying orders required before a consistent buyer is Routine. */
export const ROUTINE_MIN_ORDERS = 3;

/** Orders in the last 30 days required for Frequent Buyer. */
export const FREQUENT_MIN_ORDERS = 3;

/** Distinct categories required for Explorer. */
export const EXPLORER_MIN_CATEGORIES = 3;

export interface BehaviorProfileInput {
  /** Null when M06 has not stored a qualifying count. */
  qualifyingOrderCount: number | null;
  customerStatus: string | null;
  /** "VIP" or "Not VIP". Null when that field is not available yet. */
  vipStatus: string | null;
  purchaseConsistency: string | null;
  ordersLast30Days: number | null;
  /**
   * Undefined when category diversity was left off the contact.
   * Null when the field was written and there were no named categories.
   */
  categoryDiversity: number | null | undefined;
}

/**
 * First match wins.
 * "" is the blank written for a contact with no qualifying orders.
 * null means a later branch depends on a field this pass does not have:
 * the caller leaves `customer_behavior_profile` off the update and out of
 * `metrics_hash`. "Deal Sensitive" is never returned.
 */
export function behaviorProfile(input: BehaviorProfileInput): string | null {
  if (input.qualifyingOrderCount === null) return null;
  if (input.qualifyingOrderCount <= 0) return "";
  if (!input.customerStatus) return null;
  if (input.customerStatus === "Lapsed" || input.customerStatus === "Lost") return allowed("Lapsed");
  if (input.customerStatus === "At Risk") return allowed("At Risk");
  if (input.vipStatus === null) return null;
  if (input.vipStatus === "VIP") return allowed("High Value Buyer");
  if (input.purchaseConsistency === null) return null;
  if (isRoutine(input.purchaseConsistency) && input.qualifyingOrderCount >= ROUTINE_MIN_ORDERS) {
    return allowed("Routine Buyer");
  }
  if (input.ordersLast30Days === null) return null;
  if (input.ordersLast30Days >= FREQUENT_MIN_ORDERS) return allowed("Frequent Buyer");
  if (input.categoryDiversity === undefined) return null;
  if ((input.categoryDiversity ?? 0) >= EXPLORER_MIN_CATEGORIES) return allowed("Explorer");
  return allowed("Occasional Buyer");
}

function isRoutine(consistency: string): boolean {
  return consistency === "Highly Consistent" || consistency === "Consistent";
}

function allowed(label: string): string | null {
  const options = fieldByKey("customer_behavior_profile")?.picklistOptions ?? [];
  return options.find((option) => option === label) ?? null;
}
