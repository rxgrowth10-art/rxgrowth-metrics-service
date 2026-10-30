import { describe, expect, it } from "vitest";
import { behaviorProfile, type BehaviorProfileInput } from "../../src/metrics/behavior.js";
import { fieldByKey } from "../../src/schema/fields.js";

const options = fieldByKey("customer_behavior_profile")?.picklistOptions ?? [];

function input(overrides: Partial<BehaviorProfileInput> = {}): BehaviorProfileInput {
  return {
    qualifyingOrderCount: 4,
    customerStatus: "Active",
    vipStatus: "Not VIP",
    purchaseConsistency: "Variable",
    ordersLast30Days: 1,
    categoryDiversity: 1,
    ...overrides,
  };
}

describe("behaviour profile", () => {
  it("maps every branch and lets the earlier branch win", () => {
    expect(behaviorProfile(input({ customerStatus: "Lapsed", vipStatus: "VIP", purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 5, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("Lapsed");
    expect(behaviorProfile(input({ customerStatus: "Lost", vipStatus: "VIP", purchaseConsistency: "Consistent", qualifyingOrderCount: 5, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("Lapsed");
    expect(behaviorProfile(input({ customerStatus: "At Risk", vipStatus: "VIP", purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 5, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("At Risk");
    expect(behaviorProfile(input({ customerStatus: "Active", vipStatus: "VIP", purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 5, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("High Value Buyer");
    expect(behaviorProfile(input({ customerStatus: "New", vipStatus: "VIP", qualifyingOrderCount: 1 }))).toBe("High Value Buyer");
    expect(behaviorProfile(input({ purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 3, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("Routine Buyer");
    expect(behaviorProfile(input({ purchaseConsistency: "Consistent", qualifyingOrderCount: 3, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("Routine Buyer");
    expect(behaviorProfile(input({ purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 2, ordersLast30Days: 5, categoryDiversity: 5 }))).toBe("Frequent Buyer");
    expect(behaviorProfile(input({ purchaseConsistency: "Variable", qualifyingOrderCount: 5, ordersLast30Days: 3, categoryDiversity: 5 }))).toBe("Frequent Buyer");
    expect(behaviorProfile(input({ purchaseConsistency: "Sporadic", qualifyingOrderCount: 5, ordersLast30Days: 2, categoryDiversity: 3 }))).toBe("Explorer");
    expect(behaviorProfile(input({ purchaseConsistency: "Insufficient Data", qualifyingOrderCount: 2, ordersLast30Days: 1, categoryDiversity: 2 }))).toBe("Occasional Buyer");
    expect(behaviorProfile(input({ categoryDiversity: null }))).toBe("Occasional Buyer");
  });

  it("keeps every emitted label inside the Test Lab picklist and never emits Deal Sensitive", () => {
    const labels = [
      behaviorProfile(input({ customerStatus: "Lapsed" })),
      behaviorProfile(input({ customerStatus: "Lost" })),
      behaviorProfile(input({ customerStatus: "At Risk" })),
      behaviorProfile(input({ vipStatus: "VIP" })),
      behaviorProfile(input({ purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 3 })),
      behaviorProfile(input({ purchaseConsistency: "Consistent", qualifyingOrderCount: 3 })),
      behaviorProfile(input({ ordersLast30Days: 3 })),
      behaviorProfile(input({ categoryDiversity: 3, ordersLast30Days: 0 })),
      behaviorProfile(input()),
    ];
    expect(labels).toEqual([
      "Lapsed",
      "Lapsed",
      "At Risk",
      "High Value Buyer",
      "Routine Buyer",
      "Routine Buyer",
      "Frequent Buyer",
      "Explorer",
      "Occasional Buyer",
    ]);
    for (const label of labels) expect(options).toContain(label);
    expect(labels).not.toContain("Deal Sensitive");
    expect(options).toContain("Deal Sensitive");
  });

  it("writes blank when there are no qualifying orders", () => {
    expect(behaviorProfile(input({ qualifyingOrderCount: 0, customerStatus: "New", vipStatus: null }))).toBe("");
    expect(behaviorProfile(input({ qualifyingOrderCount: 0, customerStatus: "Lapsed", vipStatus: "VIP" }))).toBe("");
  });

  it("leaves the label off when a later branch depends on a missing gated field", () => {
    expect(behaviorProfile(input({ qualifyingOrderCount: null }))).toBeNull();
    expect(behaviorProfile(input({ customerStatus: null }))).toBeNull();
    expect(behaviorProfile(input({ vipStatus: null, customerStatus: "Active" }))).toBeNull();
    expect(behaviorProfile(input({ customerStatus: "Lapsed", vipStatus: null, categoryDiversity: undefined }))).toBe("Lapsed");
    expect(behaviorProfile(input({ customerStatus: "At Risk", vipStatus: null, categoryDiversity: undefined }))).toBe("At Risk");
    expect(behaviorProfile(input({ purchaseConsistency: null }))).toBeNull();
    expect(behaviorProfile(input({ purchaseConsistency: "Highly Consistent", qualifyingOrderCount: 3, ordersLast30Days: null }))).toBe("Routine Buyer");
    expect(behaviorProfile(input({ ordersLast30Days: null }))).toBeNull();
    expect(behaviorProfile(input({ categoryDiversity: undefined, ordersLast30Days: 0 }))).toBeNull();
    expect(behaviorProfile(input({ ordersLast30Days: 3, categoryDiversity: undefined }))).toBe("Frequent Buyer");
  });
});
