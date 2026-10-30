import { describe, expect, it } from "vitest";
import { intelligenceSummary, type IntelligenceSummaryInput } from "../../src/metrics/summary.js";

const rich: IntelligenceSummaryInput = {
  restaurantName: "Koi Roll",
  currency: "EGP",
  customerStatus: "Active",
  lifecycleStage: "ACTIVE",
  behaviorProfile: "Routine Buyer",
  purchaseConsistency: "Highly Consistent",
  qualifyingOrderCount: "4",
  ordersLast30Days: "3",
  ordersPrevious30Days: "1",
  firstOrderDate: "2026-01-02",
  lastOrderDate: "2026-06-20",
  daysSinceLastOrder: "2",
  averageOrderIntervalDays: "10.00",
  typicalOrderIntervalDays: "10.00",
  lifetimeValue: "400.00",
  averageOrderValue: "100.00",
  highestOrderValue: "150.00",
  lowestOrderValue: "50.00",
  customerValueScore: "72.50",
  lifetimeSpendPercentile: "91.00",
  orderFrequencyPercentile: "80.00",
  vipStatus: "VIP",
  vipClassification: "Spend Leader",
  favoriteItem: "Koshari",
  topItems: "Koshari, Taameya",
  favoriteCategory: "Plates",
  topCategories: "Plates, Drinks",
  categoryDiversity: "3",
  preferredOrderType: "Delivery",
  preferredLocation: "Maadi",
  primaryOrderSource: "Online Store",
  orderSourceMix: "STENZ STORE: 4",
  orderFrequencyTrend: "Increasing",
  spendingTrend: "Stable",
};

function forbidden(text: string): void {
  expect(text).not.toContain("Unknown");
  expect(text).not.toContain("N/A");
  expect(text).not.toContain("Unclassified");
  expect(text).not.toContain("{");
  expect(text).not.toContain("}");
}

describe("intelligence summary", () => {
  it("is non-empty, multi-line, and keeps the sections and values", () => {
    const text = intelligenceSummary(rich);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("\n");
    expect(text).toContain("Profile");
    expect(text).toContain("Orders");
    expect(text).toContain("Value");
    expect(text).toContain("Preferences");
    expect(text).toContain("Trends");
    expect(text).toContain("Status: Active");
    expect(text).toContain("Behavior: Routine Buyer");
    expect(text).toContain("Qualifying orders: 4");
    expect(text).toContain("Lifetime value: 400.00 EGP");
    expect(text).toContain("Favorite item: Koshari");
    expect(text).toContain("Favorite category: Plates");
    expect(text).toContain("VIP status: VIP");
    expect(text).toContain("VIP classification: Spend Leader");
    expect(text).toContain("Order frequency trend: Increasing");
    forbidden(text);
  });

  it("uses the restaurant name for that tenant", () => {
    const koi = intelligenceSummary({ ...rich, restaurantName: "Koi Roll" });
    const lab = intelligenceSummary({ ...rich, restaurantName: "Test Lab" });
    expect(koi.startsWith("Koi Roll\n")).toBe(true);
    expect(lab.startsWith("Test Lab\n")).toBe(true);
    expect(koi).not.toContain("Test Lab");
    expect(lab).not.toContain("Koi Roll");
  });

  it("drops empty values and omits sections whose data is missing", () => {
    const text = intelligenceSummary({
      restaurantName: "Test Lab",
      customerStatus: "Active",
      qualifyingOrderCount: "2",
      favoriteItem: "",
      favoriteCategory: null,
      vipStatus: null,
      vipClassification: null,
      behaviorProfile: null,
    });
    expect(text).toContain("Test Lab");
    expect(text).toContain("Status: Active");
    expect(text).toContain("Qualifying orders: 2");
    expect(text).not.toContain("Favorite item");
    expect(text).not.toContain("Favorite category");
    expect(text).not.toContain("VIP status");
    expect(text).not.toContain("VIP classification");
    expect(text).not.toContain("Behavior:");
    expect(text).not.toContain("Preferences");
    expect(text).not.toContain("Trends");
    forbidden(text);

    const empty = intelligenceSummary({ restaurantName: "Test Lab" });
    expect(empty).toBe("Test Lab\nCustomer intelligence");
    expect(empty).not.toContain("Profile");
    expect(empty).not.toContain("Orders");
    forbidden(empty);
  });

  it("returns the same text for the same input", () => {
    expect(intelligenceSummary(rich)).toBe(intelligenceSummary({ ...rich }));
    const sparse = { restaurantName: "Test Lab", customerStatus: "New" };
    expect(intelligenceSummary(sparse)).toBe(intelligenceSummary(sparse));
  });
});
