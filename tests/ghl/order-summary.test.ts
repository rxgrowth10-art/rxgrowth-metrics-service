import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseOrderPage, parseOrderResource } from "../../src/ghl/parse.js";
import {
  MemoryOrderSummaryCache,
  createOrderSummaryCache,
  createUpstashOrderSummaryCache,
  type OrderSummaryRedis,
} from "../../src/ghl/order-summary-cache.js";
import {
  ORDER_SUMMARY_MGET_CHUNK,
  ORDER_SUMMARY_TTL_SECONDS,
  orderBackfillKey,
  orderSummaryKey,
  parseStoredSummary,
  serializeOrderSummary,
  summaryFieldNames,
  summaryFromDetail,
} from "../../src/ghl/order-summary.js";
import { WEBHOOK_DETAIL_FETCH_LIMIT, resolveOrderSummaries } from "../../src/ghl/resolve-order-summaries.js";
import type { GhlClient, GhlOrder } from "../../src/ghl/index.js";
import { MemoryIdempotencyStore } from "../../src/idempotency/index.js";
import { computeM06, contactOrderSummaries, viewContactOrders } from "../../src/metrics/index.js";
import { M06_WRITTEN_KEYS, M10_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { metricsHash } from "../../src/writeback/hash.js";
import { M06_DETAIL_FIELD_KEYS } from "../../src/writeback/m06.js";
import { recomputeM06Contact } from "../../src/writeback/recompute.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const FIXTURE_HASHES = {
  list: "2fe33c1b609555c4f230ebe6fd50344d86a35a1e4686ca27243f5e3ca751f6c7",
  shipping: "c80003e4fff0d11924cd9f195959fcaffc1c6416027216e3bc84044422ac95af",
  pickup: "43779d006d76d59c4726931e31de78da09549f47d8ff18766bbd66d32233ceb1",
  bare: "152aac0cf117b4041349ec593a36f3229acd080f0d09ce57df75d60495209519",
} as const;

function load(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8"));
}

function hashOrders(orders: readonly GhlOrder[]): string {
  return metricsHash(formatM06Values(computeM06(orders, "Africa/Cairo", NOW)));
}

describe("order detail parsing", () => {
  it("reads each item field, with product name and id ahead of the variant fallbacks", () => {
    const parsed = parseOrderResource({
      order: {
        id: "order_items",
        contactId: "contact_redacted",
        amount: 400,
        status: "completed",
        paymentStatus: "paid",
        liveMode: true,
        source: { type: "pos", subType: "square", name: "STENZ STORE" },
        delivery: { method: "shipping", branch: { name: "  Maadi  " } },
        coupon: { code: "SAVE10" },
        contactSnapshot: {
          email: "secret@example.test",
          phone: "+201001112233",
          name: "Secret Name",
          address1: "1 Secret Street",
        },
        items: [
          {
            name: "test product - test product @ 200",
            productId: "variant_id",
            quantity: 9,
            product: {
              _id: "prod_real",
              name: "test product",
              collectionIds: [" col_a ", "", "col_b"],
            },
            qty: 2,
            price: { amount: 200, currency: "EGP" },
          },
        ],
      },
    });
    expect(parsed?.items).toEqual([
      {
        productId: "prod_real",
        name: "test product",
        qty: 2,
        spend: 400,
        collectionIds: ["col_a", "col_b"],
      },
    ]);
    expect(parsed).toMatchObject({
      sourceType: "pos",
      sourceSubType: "square",
      sourceName: "STENZ STORE",
      deliveryMethod: "shipping",
      branchName: "Maadi",
      couponCode: "SAVE10",
    });
  });

  it("falls back to item name, productId, and quantity, and ignores a numeric price", () => {
    const parsed = parseOrderResource({
      order: {
        id: "order_fallback",
        items: [
          {
            name: "test product - test product @ 200",
            productId: "prod_fallback",
            quantity: 3,
            price: { amount: 10.5 },
          },
          { name: "bare number", productId: "prod_number", qty: 2, price: 15 },
          { name: "  ", product: { name: "" }, qty: "4", price: { amount: "5" } },
        ],
      },
    });
    expect(parsed?.items).toEqual([
      { productId: "prod_fallback", name: "test product - test product @ 200", qty: 3, spend: 31.5, collectionIds: [] },
      { productId: "prod_number", name: "bare number", qty: 2, spend: null, collectionIds: [] },
      { productId: null, name: null, qty: 4, spend: 20, collectionIds: [] },
    ]);
  });

  it("prefers flat source fields and reads a coupon only when one is present", () => {
    const flat = parseOrderResource({
      order: {
        id: "flat",
        sourceType: "website",
        sourceSubType: "store",
        source: { type: "pos", subType: "square", name: "Other" },
        couponCode: null,
      },
    });
    expect(flat).toMatchObject({
      sourceType: "website",
      sourceSubType: "store",
      sourceName: "Other",
      couponCode: null,
      items: [],
    });
    const coded = parseOrderResource({ order: { id: "coded", couponCode: "FLAT50" } });
    expect(coded?.couponCode).toBe("FLAT50");
  });

  it("keeps the checked-in list and detail shapes, including an empty item list", () => {
    const page = parseOrderPage(load("list-orders-sample.json"));
    expect(page.orders[0]).toMatchObject({
      id: "order_sample_1",
      sourceType: "website",
      sourceSubType: "store",
      couponCode: null,
      items: [],
      branchName: null,
      deliveryMethod: null,
    });
    const shipping = parseOrderResource(load("order-detail-shipping.json"));
    const pickup = parseOrderResource(load("order-detail-pickup.json"));
    const bare = parseOrderResource(load("order-detail-no-delivery.json"));
    expect(shipping).toMatchObject({ deliveryMethod: "shipping", items: [], couponCode: null, branchName: null });
    expect(pickup?.deliveryMethod).toBe("pickup");
    expect(bare?.deliveryMethod).toBeNull();
    const listValues = formatM06Values(computeM06(page.orders, "Africa/Cairo", NOW));
    expect(listValues.lifetime_value).toBe("133.50");
    expect(listValues.total_orders).toBe("2");
    expect(listValues.last_order_type).toBe("");
    expect(listValues.primary_order_source).toBe("Online Store");
    expect(listValues.purchase_consistency).toBe("Insufficient Data");
    expect(shipping ? formatM06Values(computeM06([shipping], "Africa/Cairo", NOW)).last_order_type : null).toBe(
      "Delivery",
    );
    expect(shipping ? formatM06Values(computeM06([shipping], "Africa/Cairo", NOW)).lifetime_value : null).toBe("40.00");
    expect(pickup ? formatM06Values(computeM06([pickup], "Africa/Cairo", NOW)).preferred_order_type : null).toBe(
      "Pickup",
    );
    expect(bare ? formatM06Values(computeM06([bare], "Africa/Cairo", NOW)).preferred_order_type : null).toBe("");
    const hashes = {
      list: hashOrders(page.orders),
      shipping: shipping ? hashOrders([shipping]) : null,
      pickup: pickup ? hashOrders([pickup]) : null,
      bare: bare ? hashOrders([bare]) : null,
    };
    expect(hashes).toEqual(FIXTURE_HASHES);
  });
});

describe("order summary cache", () => {
  it("changes the key when updatedAt changes and expires after 180 days", async () => {
    expect(orderSummaryKey("loc", "order_1", "2026-06-01T00:00:00.000Z")).toBe(
      "m06:od:loc:order_1:2026-06-01T00:00:00.000Z",
    );
    expect(orderSummaryKey("loc", "order_1", "2026-06-02T00:00:00.000Z")).not.toBe(
      orderSummaryKey("loc", "order_1", "2026-06-01T00:00:00.000Z"),
    );
    expect(orderSummaryKey("loc", "order_1", null)).toBe("m06:od:loc:order_1:none");
    const cache = new MemoryOrderSummaryCache(() => 0);
    const listed = order({ id: "order_1", updatedAt: "2026-06-01T00:00:00.000Z", items: [] });
    const summary = summaryFromDetail(listed, listed);
    if (!summary) throw new Error("summary");
    await cache.setMany([{ key: orderSummaryKey("loc", "order_1", listed.updatedAt), value: serializeOrderSummary(summary) }], ORDER_SUMMARY_TTL_SECONDS);
    expect(cache.ttlSeconds(orderSummaryKey("loc", "order_1", listed.updatedAt))).toBe(ORDER_SUMMARY_TTL_SECONDS);
    expect(ORDER_SUMMARY_TTL_SECONDS).toBe(180 * 24 * 60 * 60);
  });

  it("does not store or return contactSnapshot or other customer fields", () => {
    const parsed = parseOrderResource({
      order: {
        id: "order_pii",
        contactId: "contact_secret",
        contactSnapshot: { email: "secret@example.test", phone: "+201001112233", name: "Secret Name" },
        customer: { email: "secret@example.test" },
        sourceName: "STENZ STORE",
        items: [{ name: "test product", qty: 1, price: { amount: 40 }, product: { _id: "prod_1", collectionIds: ["col_1"] } }],
      },
    });
    if (!parsed) throw new Error("parsed");
    const summary = summaryFromDetail(parsed, parsed);
    if (!summary) throw new Error("summary");
    const stored = serializeOrderSummary(summary);
    expect(stored).not.toContain("contactSnapshot");
    expect(stored).not.toContain("secret@example.test");
    expect(stored).not.toContain("+201001112233");
    expect(stored).not.toContain("Secret Name");
    expect(stored).not.toContain("contact_secret");
    expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual([...summaryFieldNames()].sort());
    const poisoned = parseStoredSummary(
      JSON.stringify({
        items: [{ productId: "prod_1", name: "test product", qty: 1, spend: 40, collectionIds: ["col_1"], email: "secret@example.test" }],
        deliveryMethod: "shipping",
        contactSnapshot: { email: "secret@example.test" },
        contactId: "contact_secret",
      }),
      "order_pii",
      null,
    );
    expect(JSON.stringify(poisoned)).not.toContain("secret@example.test");
    expect(JSON.stringify(poisoned)).not.toContain("contactSnapshot");
    expect(poisoned?.items[0]).toEqual({
      productId: "prod_1",
      name: "test product",
      qty: 1,
      spend: 40,
      collectionIds: ["col_1"],
    });
  });

  it("reads a warm contact with one MGET and zero detail fetches", async () => {
    const cache = new MemoryOrderSummaryCache(() => 0);
    const orders = ["a", "b", "c"].map((id, index) =>
      order({
        id,
        updatedAt: `2026-06-0${index + 1}T00:00:00.000Z`,
        deliveryMethod: "shipping",
        sourceType: "website",
        sourceName: "STENZ STORE",
        couponCode: null,
        branchName: null,
        items: [{ productId: `prod_${id}`, name: "test product", qty: 1, spend: 40, collectionIds: [] }],
      }),
    );
    await cache.setMany(
      orders.map((entry) => {
        const summary = summaryFromDetail(entry, entry);
        if (!summary) throw new Error(entry.id ?? "");
        return { key: orderSummaryKey("loc", entry.id ?? "", entry.updatedAt), value: serializeOrderSummary(summary) };
      }),
      ORDER_SUMMARY_TTL_SECONDS,
    );
    cache.commands.length = 0;
    let fetches = 0;
    const resolved = await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders,
      cache,
      maxFetches: WEBHOOK_DETAIL_FETCH_LIMIT,
      getOrder: async () => {
        fetches += 1;
        return null;
      },
    });
    expect(fetches).toBe(0);
    expect(cache.commands).toEqual(["mget"]);
    expect(resolved.incomplete).toBe(false);
    expect(resolved.summaries.map((summary) => summary?.items[0]?.productId)).toEqual(["prod_a", "prod_b", "prod_c"]);
    expect(viewContactOrders(resolved.orders, resolved.incomplete).summaries).toEqual(resolved.summaries);
    expect(contactOrderSummaries(resolved.orders).every((summary) => summary !== null)).toBe(true);
  });

  it("chunks MGET only after 100 keys", async () => {
    const cache = new MemoryOrderSummaryCache(() => 0);
    const orders = Array.from({ length: ORDER_SUMMARY_MGET_CHUNK + 1 }, (_, index) =>
      order({ id: `o${index}`, updatedAt: "2026-06-01T00:00:00.000Z" }),
    );
    await cache.setMany(
      orders.map((entry) => ({
        key: orderSummaryKey("loc", entry.id ?? "", entry.updatedAt),
        value: serializeOrderSummary({
          orderId: entry.id ?? "",
          updatedAt: entry.updatedAt,
          items: [],
          deliveryMethod: null,
          sourceType: null,
          sourceSubType: null,
          sourceName: null,
          couponCode: null,
          branchName: null,
        }),
      })),
      ORDER_SUMMARY_TTL_SECONDS,
    );
    cache.commands.length = 0;
    const resolved = await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders,
      cache,
      maxFetches: 2,
      getOrder: async () => {
        throw new Error("cached");
      },
    });
    expect(cache.commands.filter((command) => command === "mget")).toEqual(["mget", "mget"]);
    expect(resolved.incomplete).toBe(false);
  });

  it("fetches at most two missing details and enqueues the contact once", async () => {
    const cache = new MemoryOrderSummaryCache(() => 0);
    const orders = [1, 2, 3, 4].map((index) =>
      order({ id: `o${index}`, updatedAt: `2026-06-0${index}T00:00:00.000Z`, createdAt: `2026-06-0${index}T00:00:00.000Z` }),
    );
    const latest = orders[3];
    if (!latest?.id) throw new Error("latest");
    const known = new Map<string, GhlOrder>([
      [latest.id, order({ ...latest, items: [{ productId: "latest", name: "latest item", qty: 1, spend: 10, collectionIds: [] }] })],
    ]);
    const fetched: string[] = [];
    const resolved = await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders,
      cache,
      knownDetails: known,
      maxFetches: WEBHOOK_DETAIL_FETCH_LIMIT,
      getOrder: async (orderId) => {
        fetched.push(orderId);
        return order({
          id: orderId,
          items: [{ productId: orderId, name: "test product", qty: 1, spend: 5, collectionIds: ["col_1"] }],
        });
      },
    });
    expect(WEBHOOK_DETAIL_FETCH_LIMIT).toBe(2);
    expect(fetched).toEqual(["o1", "o2"]);
    expect(resolved.incomplete).toBe(true);
    expect(await cache.smembers(orderBackfillKey("loc"))).toEqual(["contact_1"]);
    expect(resolved.summaries.map((summary) => summary?.orderId ?? null)).toEqual(["o1", "o2", null, "o4"]);
    await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders: orders.slice(2, 3),
      cache,
      maxFetches: 0,
      getOrder: async () => null,
    });
    expect(await cache.smembers(orderBackfillKey("loc"))).toEqual(["contact_1"]);
  });

  it("refetches when updatedAt moves the cache key", async () => {
    const cache = new MemoryOrderSummaryCache(() => 0);
    const first = order({ id: "order_1", updatedAt: "v1" });
    await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders: [first],
      cache,
      maxFetches: 2,
      getOrder: async () => order({ id: "order_1", couponCode: "FIRST", items: [] }),
    });
    let fetches = 0;
    const second = await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders: [order({ id: "order_1", updatedAt: "v2" })],
      cache,
      maxFetches: 2,
      getOrder: async () => {
        fetches += 1;
        return order({ id: "order_1", couponCode: "SECOND", items: [] });
      },
    });
    expect(fetches).toBe(1);
    expect(second.summaries[0]?.couponCode).toBe("SECOND");
    const stale = await cache.mget([orderSummaryKey("loc", "order_1", "v1")]);
    expect(parseStoredSummary(stale[0], "order_1", "v1")?.couponCode).toBe("FIRST");
  });

  it("writes misses in one pipeline and reads them back with one MGET", async () => {
    const values = new Map<string, { value: string; ex: number }>();
    const calls: string[] = [];
    let sets = 0;
    const redis: OrderSummaryRedis = {
      async mget(...keys) {
        calls.push("mget");
        return keys.map((key) => values.get(key)?.value ?? null);
      },
      pipeline() {
        calls.push("pipeline");
        const queued: Array<{ key: string; value: string; ex: number }> = [];
        return {
          set(key: string, value: string, options: { ex: number }) {
            sets += 1;
            queued.push({ key, value, ex: options.ex });
          },
          async exec() {
            calls.push("exec");
            for (const entry of queued) values.set(entry.key, { value: entry.value, ex: entry.ex });
          },
        };
      },
      async sadd() {
        calls.push("sadd");
      },
      async smembers() {
        return [];
      },
      async srem() {
        return undefined;
      },
    };
    const cache = createUpstashOrderSummaryCache(redis);
    const listed = order({ id: "order_1", updatedAt: "v1", sourceType: "website" });
    await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders: [listed, order({ id: "order_2", updatedAt: "v1" })],
      cache,
      maxFetches: 2,
      getOrder: async (orderId) => order({ id: orderId, sourceType: "website", items: [] }),
    });
    expect(calls.filter((call) => call === "pipeline")).toEqual(["pipeline"]);
    expect(calls.filter((call) => call === "exec")).toEqual(["exec"]);
    expect(sets).toBe(2);
    expect([...values.values()].every((entry) => entry.ex === ORDER_SUMMARY_TTL_SECONDS)).toBe(true);
    calls.length = 0;
    const again = await resolveOrderSummaries({
      locationId: "loc",
      contactId: "contact_1",
      orders: [listed, order({ id: "order_2", updatedAt: "v1" })],
      cache,
      maxFetches: 2,
      getOrder: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(calls).toEqual(["mget"]);
    expect(again.incomplete).toBe(false);
    expect(createOrderSummaryCache({})).toBeInstanceOf(MemoryOrderSummaryCache);
  });
});

describe("webhook summary pass", () => {
  it("omits detail fields while a summary is missing, then writes them once the pass is complete", async () => {
    const cache = new MemoryOrderSummaryCache(() => NOW.getTime());
    const orders = [1, 2, 3, 4].map((index) =>
      order({
        id: `o${index}`,
        amount: 10 * index,
        createdAt: `2026-06-0${index}T00:00:00.000Z`,
        updatedAt: `2026-06-0${index}T00:00:00.000Z`,
        sourceName: "STENZ STORE",
        sourceSubType: "store",
        paymentStatus: "paid",
        liveMode: true,
      }),
    );
    const details = new Map(
      orders.map((entry) => [
        entry.id,
        order({
          ...entry,
          deliveryMethod: "shipping",
          branchName: null,
          couponCode: "SAVE10",
          items: [{ productId: "prod_1", name: "test product", qty: 1, spend: 40, collectionIds: ["col_1"] }],
        }),
      ]),
    );
    let fetches = 0;
    const updates: Array<Record<string, string>> = [];
    const client = summaryClient(orders, async (orderId) => {
      fetches += 1;
      return details.get(orderId) ?? null;
    }, updates);
    const cold = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
      orderSummaries: cache,
      summaryFetchLimit: WEBHOOK_DETAIL_FETCH_LIMIT,
    });
    expect(fetches).toBe(3);
    expect(cold.incomplete).toBe(true);
    expect(cold.written).toBe(true);
    expect(cold.summaries.map((summary) => summary?.orderId ?? null)).toEqual(["o1", "o2", null, "o4"]);
    expect(await cache.smembers(orderBackfillKey("loc_1"))).toEqual(["contact_1"]);
    const detailKeys = new Set<string>(M06_DETAIL_FIELD_KEYS);
    expect(Object.keys(updates[0] ?? {})).toEqual(M06_WRITTEN_KEYS.filter((key) => !detailKeys.has(key)));
    expect(updates[0]?.favorite_item).toBeUndefined();
    expect(updates[0]?.top_items).toBeUndefined();
    expect(updates[0]?.preferred_order_type).toBeUndefined();
    expect(updates[0]?.preferred_location).toBeUndefined();
    expect(updates[0]?.last_coupon_code).toBeUndefined();
    expect(updates[0]?.order_source_mix).toBe("STENZ STORE: 4");
    expect(updates[0]?.primary_order_source).toBe("Online Store");
    expect(updates[0]?.purchase_consistency).toBe("Highly Consistent");
    expect(updates[0]?.lifetime_value).toBe("100.00");
    expect(updates[0]?.last_order_type).toBe("Delivery");
    expect(M10_WRITTEN_KEYS).toEqual(["winback_eligibility", "winback_tier"]);
    expect(M06_WRITTEN_KEYS).toContain("favorite_item");
    expect(M06_WRITTEN_KEYS).toContain("top_items");
    expect(M06_WRITTEN_KEYS).not.toContain("last_coupon_code");
    expect(M06_WRITTEN_KEYS).not.toContain("favorite_category");
    const partial = formatM06Values(computeM06(cold.orders, "UTC", NOW));
    expect(partial.favorite_item).toBe("test product");

    const missing = orders[2];
    if (!missing?.id) throw new Error("missing order");
    const missingDetail = details.get(missing.id);
    const missingSummary = missingDetail ? summaryFromDetail(missing, missingDetail) : null;
    if (!missingSummary) throw new Error("missing summary");
    await cache.setMany(
      [{ key: orderSummaryKey("loc_1", missing.id, missing.updatedAt), value: serializeOrderSummary(missingSummary) }],
      ORDER_SUMMARY_TTL_SECONDS,
    );
    const before = cache.commands.length;
    const fetchedBefore = fetches;
    const warm = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
      orderSummaries: cache,
      summaryFetchLimit: WEBHOOK_DETAIL_FETCH_LIMIT,
    });
    expect(fetches - fetchedBefore).toBe(1);
    expect(warm.incomplete).toBe(false);
    expect(warm.written).toBe(true);
    expect(cache.commands.slice(before)).toEqual(["mget"]);
    expect(updates[1]?.favorite_item).toBe("test product");
    expect(updates[1]?.top_items).toBe("test product");
    expect(updates[1]?.preferred_order_type).toBe("Delivery");
    expect(updates[1]?.preferred_location).toBe("STENZ STORE");
    expect(updates[1]?.lifetime_value).toBe("100.00");
    expect(updates[1]?.order_source_mix).toBe("STENZ STORE: 4");
    const enriched = formatM06Values(computeM06(warm.orders, "UTC", NOW));
    const stripped = formatM06Values(
      computeM06(
        warm.orders.map((entry) => ({ ...entry, detailSummary: null, items: [], couponCode: null })),
        "UTC",
        NOW,
      ),
    );
    expect(enriched.favorite_item).toBe("test product");
    expect(stripped.favorite_item).toBe("");
    expect(enriched.lifetime_value).toBe(stripped.lifetime_value);
    expect(enriched.order_source_mix).toBe(stripped.order_source_mix);
    expect(metricsHash(enriched)).not.toBe(metricsHash(stripped));
    expect(warm.summaries[3]?.couponCode).toBe("SAVE10");
    expect(viewContactOrders(warm.orders, warm.incomplete).incomplete).toBe(false);

    const again = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
      orderSummaries: cache,
      summaryFetchLimit: WEBHOOK_DETAIL_FETCH_LIMIT,
    });
    expect(again.written).toBe(false);
    expect(again.incomplete).toBe(false);
    expect(updates).toHaveLength(2);
  });

  it("does not log the detail body when a summary fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cache = new MemoryOrderSummaryCache(() => 0);
      await resolveOrderSummaries({
        locationId: "loc",
        contactId: "contact_1",
        orders: [order({ id: "order_fail", updatedAt: "v1" })],
        cache,
        maxFetches: 2,
        getOrder: async () => {
          throw new Error('status 500 {"contactSnapshot":{"email":"secret@example.test"}}');
        },
      });
      const text = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("m06.order_summary_detail_failed");
      expect(text).not.toContain("contactSnapshot");
      expect(text).not.toContain("secret@example.test");
    } finally {
      warn.mockRestore();
    }
  });
});

function summaryClient(
  orders: GhlOrder[],
  getOrder: (orderId: string) => Promise<GhlOrder | null>,
  updates: Array<Record<string, string>>,
): GhlClient {
  let storedHash: string | null = null;
  const hashId = fieldByKey("metrics_hash")?.testLabId ?? "hash";
  return {
    async listOrders() {
      return orders;
    },
    async listLocationOrdersPage() {
      return { orders: [], totalCount: 0 };
    },
    getOrder,
    async getContact() {
      return { id: "contact_1", customFields: storedHash ? [{ id: hashId, key: "metrics_hash", value: storedHash }] : [] };
    },
    async listCustomFields() {
      return M06_WRITTEN_KEYS.map((key) => {
        const field = fieldByKey(key);
        if (!field) throw new Error(key);
        return { id: field.testLabId, fieldKey: field.fieldKey, name: field.name, dataType: field.dataType };
      });
    },
    async updateContact(_contactId, fields) {
      updates.push(Object.fromEntries(fields.map((field) => [field.key, field.value])));
      storedHash = fields.find((field) => field.key === "metrics_hash")?.value ?? storedHash;
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
}
