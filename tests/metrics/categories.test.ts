import { describe, expect, it } from "vitest";
import type { CustomFieldWrite, GhlClient, GhlContact } from "../../src/ghl/index.js";
import { parseOrderResource } from "../../src/ghl/parse.js";
import { computeM06, rankCategories } from "../../src/metrics/index.js";
import type { OrderDetailSummary, OrderLine } from "../../src/metrics/types.js";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { metricsHash } from "../../src/writeback/hash.js";
import { writeM06Metrics } from "../../src/writeback/m06.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T12:00:00.000Z");

const NAMES = new Map<string, string | null>([
  ["rolls", "Rolls"],
  ["bowls", "Bowls"],
  ["soups", "Soups"],
  ["sides", "Sides"],
  ["drinks", "Drinks"],
  ["desserts", "Desserts"],
  ["unknown", null],
]);

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    productId: overrides.productId ?? "prod",
    name: overrides.name ?? "Item",
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

function fieldCatalog() {
  return M06_WRITTEN_KEYS.map((key) => {
    const field = fieldByKey(key);
    if (!field) throw new Error(key);
    return { id: field.testLabId, fieldKey: field.fieldKey, name: field.name, dataType: field.dataType };
  });
}

function clientWith() {
  const updates: CustomFieldWrite[][] = [];
  let storedHash: string | null = null;
  const hashId = fieldByKey("metrics_hash")?.testLabId ?? "hash";
  const client: GhlClient = {
    async listOrders() {
      return [];
    },
    async listLocationOrdersPage() {
      return { orders: [], totalCount: 0 };
    },
    async getOrder() {
      return null;
    },
    async getContact(): Promise<GhlContact> {
      return {
        id: "contact_1",
        customFields: storedHash ? [{ id: hashId, key: "metrics_hash", value: storedHash }] : [],
      };
    },
    async listCustomFields() {
      return fieldCatalog();
    },
    async listCollections() {
      return [];
    },
    async updateContact(_contactId, fields) {
      updates.push([...fields]);
      storedHash = fields.find((field) => field.key === "metrics_hash")?.value ?? null;
    },
    async searchContacts() {
      return [];
    },
    async searchContactsPage() {
      return { contacts: [], searchAfter: null };
    },
    async addContactToWorkflow() {
      return undefined;
    },
  };
  return { client, updates };
}

describe("favorite category, top categories, and diversity", () => {
  it("ranks by quantity, then line spend, then the latest order date", () => {
    const metrics = computeM06(
      [
        order({
          createdAt: "2026-06-01T00:00:00.000Z",
          items: [line({ collectionIds: ["bowls"], qty: 2, spend: 20 })],
        }),
        order({
          createdAt: "2026-06-08T00:00:00.000Z",
          items: [
            line({ collectionIds: ["rolls"], qty: 2, spend: 50 }),
            line({ collectionIds: ["soups"], qty: 5, spend: 5 }),
          ],
        }),
      ],
      "UTC",
      NOW,
      { collectionNames: NAMES },
    );
    expect(metrics.favoriteCategory).toBe("Soups");
    expect(metrics.topCategories).toBe("Soups, Rolls, Bowls");
    expect(metrics.categoryDiversity).toBe(3);
    expect(metrics.topCategories?.split(", ")).toContain(metrics.favoriteCategory);
    expect(formatM06Values(metrics).favorite_category).toBe("Soups");
    expect(formatM06Values(metrics).top_categories).toBe("Soups, Rolls, Bowls");
    expect(formatM06Values(metrics).category_diversity).toBe("3");

    const tiedSpend = rankCategories(
      [
        order({
          createdAt: "2026-06-01T00:00:00.000Z",
          items: [line({ collectionIds: ["bowls"], qty: 4, spend: 10 })],
        }),
        order({
          createdAt: "2026-06-02T00:00:00.000Z",
          items: [line({ collectionIds: ["rolls"], qty: 4, spend: 50 })],
        }),
      ],
      NAMES,
    );
    expect(tiedSpend.favoriteCategory).toBe("Rolls");

    const tiedDate = rankCategories(
      [
        order({
          createdAt: "2026-06-01T00:00:00.000Z",
          items: [line({ collectionIds: ["bowls"], qty: 1, spend: 10 })],
        }),
        order({
          createdAt: "2026-06-03T00:00:00.000Z",
          items: [line({ collectionIds: ["rolls"], qty: 1, spend: 10 })],
        }),
      ],
      NAMES,
    );
    expect(tiedDate.favoriteCategory).toBe("Rolls");
    expect(tiedDate.topCategories).toBe("Rolls, Bowls");
    expect(tiedDate.categoryDiversity).toBe(2);
  });

  it("keeps five names, counts every distinct category, and gives each collection the full line", () => {
    const ids = ["rolls", "bowls", "soups", "sides", "drinks", "desserts"];
    const metrics = computeM06(
      [
        order({
          items: ids.map((id, index) => line({ collectionIds: [id], qty: ids.length - index, spend: 1 })),
        }),
      ],
      "UTC",
      NOW,
      { collectionNames: NAMES },
    );
    expect(metrics.favoriteCategory).toBe("Rolls");
    expect(metrics.topCategories).toBe("Rolls, Bowls, Soups, Sides, Drinks");
    expect(metrics.categoryDiversity).toBe(6);
    expect(metrics.topCategories?.split(", ")).toContain(metrics.favoriteCategory);
    expect(formatM06Values(metrics).top_categories).not.toContain("Desserts");
    expect(formatM06Values(metrics).category_diversity).toBe("6");

    const shared = rankCategories(
      [
        order({
          items: [
            line({ collectionIds: ["rolls", "bowls"], qty: 3, spend: 30 }),
            line({ collectionIds: ["soups"], qty: 2, spend: 100 }),
          ],
        }),
      ],
      NAMES,
    );
    expect(shared.favoriteCategory).toBe("Rolls");
    expect(shared.topCategories).toBe("Rolls, Bowls, Soups");
    expect(shared.categoryDiversity).toBe(3);
    expect(shared.topCategories?.split(", ").length).toBe(shared.categoryDiversity);

    const aliased = new Map(NAMES);
    aliased.set("rolls-copy", "Rolls");
    const once = rankCategories(
      [
        order({
          items: [
            line({ collectionIds: ["rolls", "rolls-copy"], qty: 4, spend: 4 }),
            line({ collectionIds: ["soups"], qty: 5, spend: 1 }),
          ],
        }),
      ],
      aliased,
    );
    expect(once.favoriteCategory).toBe("Soups");
    expect(once.categoryDiversity).toBe(2);
  });

  it("drops a line with no collection and a collection the cache cannot name", () => {
    const metrics = computeM06(
      [
        order({
          items: [
            line({ name: "Bare", collectionIds: [], qty: 9, spend: 90 }),
            line({ name: "Missing", collectionIds: ["not-in-map"], qty: 8, spend: 80 }),
            line({ name: "Nameless", collectionIds: ["unknown"], qty: 7, spend: 70 }),
            line({ name: "Named", collectionIds: ["rolls"], qty: 1, spend: 1 }),
          ],
        }),
      ],
      "UTC",
      NOW,
      { collectionNames: NAMES },
    );
    expect(metrics.favoriteCategory).toBe("Rolls");
    expect(metrics.topCategories).toBe("Rolls");
    expect(metrics.categoryDiversity).toBe(1);
    expect(metrics.topCategories).not.toContain("Uncategorized");
    expect(formatM06Values(metrics)).toMatchObject({
      favorite_category: "Rolls",
      top_categories: "Rolls",
      category_diversity: "1",
    });

    const empty = formatM06Values(
      computeM06([order({ items: [line({ collectionIds: [] })] })], "UTC", NOW, { collectionNames: NAMES }),
    );
    expect(empty.favorite_category).toBe("");
    expect(empty.top_categories).toBe("");
    expect(empty.category_diversity).toBe("");
  });

  it("reads product.collectionIds and ignores orders that do not qualify", () => {
    const parsed = parseOrderResource({
      order: {
        id: "priced",
        contactId: "contact_1",
        status: "completed",
        paymentStatus: "paid",
        liveMode: true,
        markAsTest: false,
        amount: 10,
        createdAt: "2026-06-01T00:00:00.000Z",
        items: [
          {
            name: "variant label",
            qty: 2,
            price: { amount: 5 },
            product: { _id: "prod", name: "Roll", collectionIds: ["rolls", "rolls", "bowls"] },
          },
        ],
      },
    });
    expect(parsed?.items[0]?.collectionIds).toEqual(["rolls", "rolls", "bowls"]);
    const fromDetail = rankCategories(parsed ? [parsed] : [], NAMES);
    expect(fromDetail.categoryDiversity).toBe(2);
    expect(fromDetail.topCategories?.split(", ").sort()).toEqual(["Bowls", "Rolls"]);
    expect(["Rolls", "Bowls"]).toContain(fromDetail.favoriteCategory);

    const cached = computeM06(
      [
        order({
          items: [line({ collectionIds: ["soups"], qty: 9, spend: 90 })],
          detailSummary: summary([line({ collectionIds: ["rolls"], qty: 1, spend: 1 })]),
        }),
      ],
      "UTC",
      NOW,
      { collectionNames: NAMES },
    );
    expect(cached.favoriteCategory).toBe("Rolls");

    const mixed = computeM06(
      [
        order({
          status: "cancelled",
          items: [line({ collectionIds: ["soups"], qty: 50, spend: 500 })],
        }),
        order({
          paymentStatus: "refunded",
          items: [line({ collectionIds: ["bowls"], qty: 40, spend: 400 })],
        }),
        order({
          paymentStatus: "unpaid",
          status: "unfulfilled",
          fulfillmentStatus: "unfulfilled",
          items: [line({ collectionIds: ["rolls"], qty: 2, spend: 20 })],
        }),
      ],
      "UTC",
      NOW,
      { collectionNames: NAMES },
    );
    expect(mixed.qualifyingOrderCount).toBe(1);
    expect(mixed.favoriteCategory).toBe("Rolls");
    expect(mixed.topCategories).toBe("Rolls");
    expect(mixed.categoryDiversity).toBe(1);
  });
});

describe("category completeness gate", () => {
  const orders = [
    order({
      id: "o1",
      amount: 40,
      createdAt: "2026-06-01T00:00:00.000Z",
      sourceName: "STENZ STORE",
      sourceType: "website",
      sourceSubType: "store",
      deliveryMethod: "shipping",
      items: [line({ name: "Koshari", collectionIds: ["rolls"], qty: 2, spend: 40 })],
    }),
  ];

  it("leaves category fields out of an incomplete hash, then writes them when details and names are ready", async () => {
    const harness = clientWith();
    const names = new Map<string, string | null>([["rolls", "Rolls"]]);
    const first = await writeM06Metrics({
      client: harness.client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
      orderDetailsComplete: false,
      collectionNames: names,
      categoriesResolved: true,
    });
    const second = await writeM06Metrics({
      client: harness.client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
      orderDetailsComplete: false,
      collectionNames: names,
      categoriesResolved: true,
    });
    expect(first.written).toBe(true);
    expect(second).toEqual({ written: false, hash: first.hash, reason: "unchanged" });
    const blocked = harness.updates[0] ?? [];
    expect(blocked.some((field) => field.key === "favorite_item")).toBe(false);
    expect(blocked.some((field) => field.key === "favorite_category")).toBe(false);
    expect(blocked.some((field) => field.key === "top_categories")).toBe(false);
    expect(blocked.some((field) => field.key === "category_diversity")).toBe(false);

    const complete = await writeM06Metrics({
      client: harness.client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
      orderDetailsComplete: true,
      collectionNames: names,
      categoriesResolved: true,
    });
    expect(complete.written).toBe(true);
    expect(complete.hash).not.toBe(first.hash);
    const written = harness.updates[1] ?? [];
    expect(written.find((field) => field.key === "favorite_item")?.value).toBe("Koshari");
    expect(written.find((field) => field.key === "favorite_category")?.value).toBe("Rolls");
    expect(written.find((field) => field.key === "top_categories")?.value).toBe("Rolls");
    expect(written.find((field) => field.key === "category_diversity")?.value).toBe("1");
    expect(written.find((field) => field.key === "metrics_hash")?.value).toBe(
      metricsHash(Object.fromEntries(written.filter((field) => field.key !== "metrics_hash" && field.key !== "m06_intelligence_updated_at").map((field) => [field.key, field.value]))),
    );
  });

  it("keeps item fields and drops category fields when the name refresh fails", async () => {
    const harness = clientWith();
    const failed = await writeM06Metrics({
      client: harness.client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
      orderDetailsComplete: true,
      categoriesResolved: false,
    });
    const again = await writeM06Metrics({
      client: harness.client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
      orderDetailsComplete: true,
      categoriesResolved: false,
    });
    expect(failed.written).toBe(true);
    expect(again).toEqual({ written: false, hash: failed.hash, reason: "unchanged" });
    const fields = harness.updates[0] ?? [];
    expect(fields.find((field) => field.key === "favorite_item")?.value).toBe("Koshari");
    expect(fields.some((field) => field.key === "favorite_category")).toBe(false);
    expect(fields.some((field) => field.key === "top_categories")).toBe(false);
    expect(fields.some((field) => field.key === "category_diversity")).toBe(false);

    const named = await writeM06Metrics({
      client: harness.client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
      orderDetailsComplete: true,
      collectionNames: new Map([["rolls", "Rolls"]]),
      categoriesResolved: true,
    });
    expect(named.written).toBe(true);
    expect(named.hash).not.toBe(failed.hash);
    expect(harness.updates[1]?.find((field) => field.key === "favorite_category")?.value).toBe("Rolls");
  });
});
