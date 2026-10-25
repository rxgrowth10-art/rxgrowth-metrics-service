import { describe, expect, it } from "vitest";
import { parseOrderResource } from "../../src/ghl/parse.js";
import { computeM06, rankFavoriteItems } from "../../src/metrics/index.js";
import type { OrderDetailSummary, OrderLine } from "../../src/metrics/types.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T12:00:00.000Z");

function line(overrides: Partial<OrderLine> & Pick<OrderLine, "name">): OrderLine {
  return {
    productId: overrides.productId ?? overrides.name,
    name: overrides.name,
    qty: overrides.qty ?? 1,
    spend: overrides.spend ?? 0,
    collectionIds: overrides.collectionIds ?? [],
  };
}

function summary(items: OrderLine[]): OrderDetailSummary {
  return {
    orderId: "cached",
    updatedAt: null,
    items,
    deliveryMethod: null,
    sourceType: null,
    sourceSubType: null,
    sourceName: null,
    couponCode: null,
    branchName: null,
  };
}

describe("favorite item and top items", () => {
  it("ranks by quantity, then line spend, then the latest order date", () => {
    const metrics = computeM06(
      [
        order({
          id: "early",
          amount: 30,
          createdAt: "2026-06-01T00:00:00.000Z",
          items: [line({ name: "Early", qty: 2, spend: 20 })],
        }),
        order({
          id: "later",
          amount: 30,
          createdAt: "2026-06-08T00:00:00.000Z",
          items: [
            line({ name: "Later", qty: 2, spend: 20 }),
            line({ name: "Many", qty: 5, spend: 5 }),
            line({ name: "Pricey", qty: 3, spend: 90 }),
          ],
        }),
      ],
      "UTC",
      NOW,
    );
    expect(metrics.favoriteItem).toBe("Many");
    expect(metrics.topItems).toBe("Many, Pricey, Later, Early");
    expect(formatM06Values(metrics).favorite_item).toBe("Many");
    expect(formatM06Values(metrics).top_items).toBe("Many, Pricey, Later, Early");

    const tied = rankFavoriteItems([
      order({
        createdAt: "2026-06-01T00:00:00.000Z",
        items: [line({ productId: "same-qty", name: "Low spend", qty: 4, spend: 10 })],
      }),
      order({
        createdAt: "2026-06-02T00:00:00.000Z",
        items: [line({ productId: "same-qty-rich", name: "High spend", qty: 4, spend: 50 })],
      }),
    ]);
    expect(tied.favoriteItem).toBe("High spend");

    const dated = rankFavoriteItems([
      order({
        createdAt: "2026-06-01T00:00:00.000Z",
        items: [line({ name: "Older", qty: 1, spend: 10 })],
      }),
      order({
        createdAt: "2026-06-03T00:00:00.000Z",
        items: [line({ name: "Newer", qty: 1, spend: 10 })],
      }),
    ]);
    expect(dated.favoriteItem).toBe("Newer");
    expect(dated.topItems).toBe("Newer, Older");
  });

  it("uses the product name ahead of the variant name and price.amount for spend", () => {
    const parsed = parseOrderResource({
      order: {
        id: "priced",
        contactId: "contact_1",
        status: "completed",
        paymentStatus: "paid",
        liveMode: true,
        markAsTest: false,
        amount: 100,
        createdAt: "2026-06-01T00:00:00.000Z",
        items: [
          {
            name: "test product - test product @ 200",
            productId: "variant_id",
            qty: 2,
            price: { amount: 10 },
            product: { _id: "prod_real", name: "test product" },
          },
          {
            name: "numeric price",
            productId: "prod_number",
            qty: 2,
            price: 15,
            product: { _id: "prod_number", name: "numeric price" },
          },
          {
            name: "pricey",
            productId: "prod_pricey",
            qty: 2,
            price: { amount: 40 },
            product: { _id: "prod_pricey", name: "pricey" },
          },
        ],
      },
    });
    if (!parsed) throw new Error("parsed");
    const ranking = rankFavoriteItems([parsed]);
    expect(parsed.items[0]).toMatchObject({ productId: "prod_real", name: "test product", qty: 2, spend: 20 });
    expect(parsed.items[1]?.spend).toBeNull();
    expect(ranking.favoriteItem).toBe("pricey");
    expect(ranking.topItems).toBe("pricey, test product, numeric price");
  });

  it("keeps five names and writes empty text when the qualifying orders have no lines", () => {
    const names = ["One", "Two", "Three", "Four", "Five", "Six"];
    const metrics = computeM06(
      [
        order({
          items: names.map((name, index) => line({ name, qty: names.length - index, spend: 1 })),
        }),
      ],
      "UTC",
      NOW,
    );
    expect(metrics.topItems).toBe("One, Two, Three, Four, Five");
    expect(metrics.favoriteItem).toBe("One");
    expect(formatM06Values(metrics).top_items).not.toContain("Six");

    const empty = formatM06Values(computeM06([order({ items: [] })], "UTC", NOW));
    expect(empty.favorite_item).toBe("");
    expect(empty.top_items).toBe("");
  });

  it("reads cached detail lines and ignores orders that do not qualify", () => {
    const cached = computeM06(
      [
        order({
          items: [line({ name: "From list", qty: 9, spend: 90 })],
          detailSummary: summary([line({ name: "From detail", qty: 1, spend: 1 })]),
        }),
      ],
      "UTC",
      NOW,
    );
    expect(cached.favoriteItem).toBe("From detail");

    const mixed = computeM06(
      [
        order({
          status: "cancelled",
          paymentStatus: "paid",
          items: [line({ name: "Cancelled", qty: 50, spend: 500 })],
        }),
        order({
          paymentStatus: "refunded",
          items: [line({ name: "Refunded", qty: 40, spend: 400 })],
        }),
        order({
          paymentStatus: "unpaid",
          status: "unfulfilled",
          fulfillmentStatus: "unfulfilled",
          items: [line({ name: "COD", qty: 2, spend: 20 })],
        }),
      ],
      "UTC",
      NOW,
    );
    expect(mixed.qualifyingOrderCount).toBe(1);
    expect(mixed.favoriteItem).toBe("COD");
    expect(mixed.topItems).toBe("COD");
  });
});
