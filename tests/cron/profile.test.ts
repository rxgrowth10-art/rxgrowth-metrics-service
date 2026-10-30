import { describe, expect, it } from "vitest";
import { nightlyProfile } from "../../src/cron/profile.js";
import type { GhlContact } from "../../src/ghl/index.js";
import { FIELDS } from "../../src/schema/fields.js";

const ids = new Map(FIELDS.map((field) => [field.key, field.testLabId]));

function contact(values: Record<string, string>): GhlContact {
  return {
    id: "contact_1",
    customFields: Object.entries(values).map(([key, value]) => {
      const field = FIELDS.find((item) => item.key === key);
      if (!field) throw new Error(key);
      return { id: field.testLabId, key: field.fieldKey, value };
    }),
  };
}

const active: Record<string, string> = {
  qualifying_order_count: "4",
  customer_status: "Active",
  vip_status: "Not VIP",
  purchase_consistency: "Variable",
  orders_last_30_days: "1",
  category_diversity: "1",
  lifetime_value: "80.00",
  favorite_item: "Koshari",
  favorite_category: "Plates",
};

describe("nightly profile", () => {
  it("classifies from stored fields and names the tenant in the summary", () => {
    const profile = nightlyProfile({
      contact: contact(active),
      ids,
      restaurantName: "Koi Roll",
      currency: "EGP",
    });
    expect(profile.behavior).toBe("Occasional Buyer");
    expect(profile.summary.startsWith("Koi Roll\n")).toBe(true);
    expect(profile.summary).toContain("Favorite item: Koshari");
    expect(profile.summary).toContain("Lifetime value: 80.00 EGP");
    expect(profile.summary).not.toContain("Test Lab");
    expect(profile.summary).not.toContain("Deal Sensitive");
  });

  it("blanks a contact with no qualifying orders", () => {
    const profile = nightlyProfile({
      contact: contact({ qualifying_order_count: "0", customer_status: "New" }),
      ids,
      restaurantName: "Test Lab",
      currency: "EGP",
    });
    expect(profile.behavior).toBe("");
    expect(profile.summary).not.toContain("Behavior:");
  });

  it("ignores a stale category or VIP value when tonight's recompute left that key off", () => {
    const stored = contact({
      ...active,
      category_diversity: "5",
      favorite_category: "Plates",
      vip_status: "VIP",
      vip_classification: "Spend Leader",
      customer_value_score: "90.00",
    });
    const withoutCategory = nightlyProfile({
      contact: stored,
      ids,
      restaurantName: "Test Lab",
      currency: "EGP",
      fresh: {
        qualifying_order_count: "4",
        customer_status: "Active",
        vip_status: "Not VIP",
        vip_classification: "Not VIP",
        purchase_consistency: "Variable",
        orders_last_30_days: "1",
        lifetime_value: "80.00",
        favorite_item: "Koshari",
      },
    });
    expect(withoutCategory.behavior).toBeNull();
    expect(withoutCategory.summary).not.toContain("Favorite category");
    expect(withoutCategory.summary).not.toContain("Category diversity");
    expect(withoutCategory.summary).toContain("VIP status: Not VIP");

    const withoutVip = nightlyProfile({
      contact: stored,
      ids,
      restaurantName: "Test Lab",
      currency: "EGP",
      fresh: {
        qualifying_order_count: "4",
        customer_status: "Active",
        purchase_consistency: "Highly Consistent",
        orders_last_30_days: "1",
        category_diversity: "1",
        favorite_category: "Plates",
        favorite_item: "Koshari",
      },
    });
    expect(withoutVip.behavior).toBeNull();
    expect(withoutVip.summary).not.toContain("VIP status");
    expect(withoutVip.summary).not.toContain("VIP classification");
    expect(withoutVip.summary).toContain("Favorite category: Plates");
  });

  it("still labels Lapsed when VIP has not been written", () => {
    const profile = nightlyProfile({
      contact: contact({
        qualifying_order_count: "4",
        customer_status: "Lapsed",
        purchase_consistency: "Highly Consistent",
      }),
      ids,
      restaurantName: "Test Lab",
      currency: "EGP",
    });
    expect(profile.behavior).toBe("Lapsed");
    expect(profile.summary).toContain("Behavior: Lapsed");
    expect(profile.summary).not.toContain("VIP status");
  });
});
