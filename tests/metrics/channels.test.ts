import { describe, expect, it } from "vitest";
import { computeM06, classifyOrderSource } from "../../src/metrics/index.js";
import type { OrderDetailSummary } from "../../src/metrics/types.js";
import { fieldByKey } from "../../src/schema/fields.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T12:00:00.000Z");

function detail(overrides: Partial<OrderDetailSummary>): OrderDetailSummary {
  return {
    orderId: "cached",
    updatedAt: null,
    items: [],
    deliveryMethod: null,
    sourceType: null,
    sourceSubType: null,
    sourceName: null,
    couponCode: null,
    branchName: null,
    ...overrides,
  };
}

describe("preferred order type and location", () => {
  it("maps shipping to Delivery and pickup to Pickup, and leaves an unknown type blank", () => {
    const shipping = formatM06Values(
      computeM06([order({ deliveryMethod: "shipping", createdAt: "2026-06-01T00:00:00.000Z" })], "UTC", NOW),
    );
    const pickup = formatM06Values(
      computeM06([order({ deliveryMethod: "PICKUP", createdAt: "2026-06-01T00:00:00.000Z" })], "UTC", NOW),
    );
    const unknown = formatM06Values(
      computeM06(
        [order({ deliveryMethod: "dine-in", sourceSubType: "store", createdAt: "2026-06-01T00:00:00.000Z" })],
        "UTC",
        NOW,
      ),
    );
    expect(shipping.preferred_order_type).toBe("Delivery");
    expect(pickup.preferred_order_type).toBe("Pickup");
    expect(unknown.preferred_order_type).toBe("");
    expect(fieldByKey("preferred_order_type")?.picklistOptions).toContain("Delivery");
    expect(fieldByKey("preferred_order_type")?.picklistOptions).not.toContain("shipping");
  });

  it("breaks order-type and location ties by count, then spend, then latest date", () => {
    const typed = formatM06Values(
      computeM06(
        [
          order({ deliveryMethod: "shipping", amount: 10, createdAt: "2026-06-01T00:00:00.000Z" }),
          order({ deliveryMethod: "shipping", amount: 10, createdAt: "2026-06-02T00:00:00.000Z" }),
          order({ deliveryMethod: "pickup", amount: 100, createdAt: "2026-06-03T00:00:00.000Z" }),
          order({ deliveryMethod: "pickup", amount: 100, createdAt: "2026-06-04T00:00:00.000Z" }),
          order({ deliveryMethod: "courier", amount: 500, createdAt: "2026-06-05T00:00:00.000Z" }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(typed.preferred_order_type).toBe("Pickup");

    const dated = formatM06Values(
      computeM06(
        [
          order({ deliveryMethod: "shipping", amount: 40, createdAt: "2026-06-01T00:00:00.000Z" }),
          order({ deliveryMethod: "pickup", amount: 40, createdAt: "2026-06-04T00:00:00.000Z" }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(dated.preferred_order_type).toBe("Pickup");

    const located = formatM06Values(
      computeM06(
        [
          order({
            branchName: "Maadi",
            sourceName: "STENZ STORE",
            amount: 10,
            createdAt: "2026-06-01T00:00:00.000Z",
          }),
          order({
            branchName: null,
            sourceName: "STENZ STORE",
            amount: 50,
            createdAt: "2026-06-02T00:00:00.000Z",
          }),
          order({
            branchName: "Maadi",
            sourceName: "OTHER",
            amount: 10,
            createdAt: "2026-06-03T00:00:00.000Z",
          }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(located.preferred_location).toBe("Maadi");
    expect(located.last_order_location).toBe("Maadi");
  });

  it("uses the cached branch, otherwise the source name, and writes empty text when neither exists", () => {
    const cached = formatM06Values(
      computeM06(
        [
          order({
            branchName: "List branch",
            sourceName: "STENZ STORE",
            detailSummary: detail({ branchName: "Maadi", sourceName: "STENZ STORE", deliveryMethod: "shipping" }),
          }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(cached.preferred_location).toBe("Maadi");
    expect(cached.preferred_order_type).toBe("Delivery");

    const source = formatM06Values(
      computeM06([order({ branchName: null, sourceName: "STENZ STORE", deliveryMethod: null })], "UTC", NOW),
    );
    expect(source.preferred_location).toBe("STENZ STORE");

    const none = formatM06Values(
      computeM06([order({ branchName: null, sourceName: null, deliveryMethod: null })], "UTC", NOW),
    );
    expect(none.preferred_location).toBe("");
    expect(none.preferred_order_type).toBe("");
  });
});

describe("order source mix and primary order source", () => {
  it("writes source name counts and maps the winning category onto the picklist", () => {
    const options = fieldByKey("primary_order_source")?.picklistOptions ?? [];
    const metrics = computeM06(
      [
        order({
          sourceName: "STENZ STORE",
          sourceType: "website",
          sourceSubType: "store",
          amount: 10,
          createdAt: "2026-06-01T00:00:00.000Z",
        }),
        order({
          sourceName: "STENZ STORE",
          sourceType: "funnel",
          sourceSubType: null,
          amount: 15,
          createdAt: "2026-06-02T00:00:00.000Z",
        }),
        order({
          sourceName: "Talabat",
          sourceType: "talabat",
          sourceSubType: null,
          amount: 100,
          createdAt: "2026-06-03T00:00:00.000Z",
        }),
        order({
          sourceName: null,
          sourceType: "pos",
          sourceSubType: null,
          amount: 5,
          createdAt: "2026-06-04T00:00:00.000Z",
        }),
      ],
      "UTC",
      NOW,
    );
    const formatted = formatM06Values(metrics);
    expect(formatted.order_source_mix).toBe("STENZ STORE: 2, Talabat: 1");
    expect(formatted.primary_order_source).toBe("Online Store");
    expect(options).toContain(formatted.primary_order_source);

    const spendTie = formatM06Values(
      computeM06(
        [
          order({ sourceName: "A", sourceType: "website", amount: 10, createdAt: "2026-06-01T00:00:00.000Z" }),
          order({ sourceName: "B", sourceType: "pos", amount: 50, createdAt: "2026-06-02T00:00:00.000Z" }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(spendTie.order_source_mix).toBe("B: 1, A: 1");
    expect(spendTie.primary_order_source).toBe("POS");

    const later = formatM06Values(
      computeM06(
        [
          order({ sourceName: "Web", sourceType: "website", amount: 20, createdAt: "2026-06-01T00:00:00.000Z" }),
          order({ sourceName: "Till", sourceType: "pos", amount: 20, createdAt: "2026-06-05T00:00:00.000Z" }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(later.primary_order_source).toBe("POS");
    expect(later.order_source_mix).toBe("Till: 1, Web: 1");
  });

  it("maps source type, subtype, and delivery-integration names onto picklist options", () => {
    const options = fieldByKey("primary_order_source")?.picklistOptions ?? [];
    const cases: Array<{ sourceType?: string | null; sourceSubType?: string | null; sourceName?: string | null; label: string }> = [
      { sourceType: "website", label: "Online Store" },
      { sourceType: "funnel", label: "Online Store" },
      { sourceType: "store", label: "Online Store" },
      { sourceSubType: "store", sourceType: null, label: "Online Store" },
      { sourceType: "pos", sourceSubType: "square", label: "POS" },
      { sourceType: "talabat", label: "Delivery Platform" },
      { sourceType: null, sourceSubType: null, sourceName: "El Menus", label: "Delivery Platform" },
      { sourceType: "uber_eats", label: "Delivery Platform" },
      { sourceType: "manual", sourceName: "Talabat", label: "Manual" },
      { sourceType: "invoice", label: "Manual" },
      { sourceType: "import", label: "Imported" },
      { sourceType: "imported", label: "Imported" },
      { sourceType: "membership", label: "Other" },
      { sourceType: null, sourceSubType: "Pickup", sourceName: "Counter", label: "Other" },
    ];
    for (const entry of cases) {
      const label = classifyOrderSource(
        order({
          sourceType: entry.sourceType ?? null,
          sourceSubType: entry.sourceSubType ?? null,
          sourceName: entry.sourceName ?? null,
        }),
      );
      expect(label, JSON.stringify(entry)).toBe(entry.label);
      expect(options).toContain(label);
    }

    const formatted = formatM06Values(
      computeM06([order({ sourceType: null, sourceSubType: null, sourceName: null })], "UTC", NOW),
    );
    expect(formatted.primary_order_source).toBe("Other");
    expect(formatted.order_source_mix).toBe("");

    const none = formatM06Values(computeM06([], "UTC", NOW));
    expect(none.primary_order_source).toBe("");
    expect(none.order_source_mix).toBe("");
    expect(none.purchase_consistency).toBe("Insufficient Data");
  });

  it("does not let a cancelled order change the mix or the primary source", () => {
    const formatted = formatM06Values(
      computeM06(
        [
          order({ sourceName: "STENZ STORE", sourceType: "website", amount: 20, createdAt: "2026-06-01T00:00:00.000Z" }),
          order({
            status: "cancelled",
            sourceName: "Talabat",
            sourceType: "talabat",
            amount: 500,
            createdAt: "2026-06-02T00:00:00.000Z",
          }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(formatted.order_source_mix).toBe("STENZ STORE: 1");
    expect(formatted.primary_order_source).toBe("Online Store");
    expect(formatted.qualifying_order_count).toBe("1");
  });
});
