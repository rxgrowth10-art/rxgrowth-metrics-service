import { afterEach, describe, expect, it, vi } from "vitest";
import { COLLECTIONS_PAGE_LIMIT, createGhlClient } from "../../src/ghl/client.js";
import {
  COLLECTIONS_TTL_SECONDS,
  collectionsCacheKey,
  loadCollectionNames,
} from "../../src/ghl/collections.js";
import { GhlRequestError } from "../../src/ghl/errors.js";
import { MemoryOrderSummaryCache } from "../../src/ghl/order-summary-cache.js";
import type { GhlClient, GhlCollection } from "../../src/ghl/types.js";
import { MemoryIdempotencyStore, type IdempotencyStore } from "../../src/idempotency/index.js";
import { parseCollections } from "../../src/ghl/parse.js";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import { recomputeM06Contact } from "../../src/writeback/recompute.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T12:00:00.000Z");

class CountingStore implements IdempotencyStore {
  readonly gets: string[] = [];
  readonly sets: string[] = [];

  constructor(private readonly inner: IdempotencyStore) {}

  async setNx(key: string, ttlSeconds: number): Promise<boolean> {
    return this.inner.setNx(key, ttlSeconds);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.sets.push(key);
    await this.inner.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.inner.del(key);
  }

  async get(key: string): Promise<string | null> {
    this.gets.push(key);
    return this.inner.get(key);
  }
}

describe("collection name cache", () => {
  it("reads one Redis key on a hit and does not call GHL", async () => {
    const inner = new MemoryIdempotencyStore(() => 0);
    const key = collectionsCacheKey("loc_1");
    await inner.set(key, JSON.stringify({ col_rolls: "Rolls", col_gone: null }), COLLECTIONS_TTL_SECONDS);
    const store = new CountingStore(inner);
    let calls = 0;
    const loaded = await loadCollectionNames({
      store,
      locationId: "loc_1",
      ids: ["col_rolls", "col_gone", "col_rolls"],
      client: {
        async listCollections() {
          calls += 1;
          return [];
        },
      },
    });
    expect(calls).toBe(0);
    expect(store.gets).toEqual([key]);
    expect(store.sets).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(loaded.names.get("col_rolls")).toBe("Rolls");
    expect(loaded.names.get("col_gone")).toBeNull();
  });

  it("refreshes a miss, stores an unknown id as null, and expires after 24 hours", async () => {
    let now = 0;
    const inner = new MemoryIdempotencyStore(() => now);
    const store = new CountingStore(inner);
    const requested: string[][] = [];
    const loaded = await loadCollectionNames({
      store,
      locationId: "loc_1",
      ids: ["col_rolls", "col_rolls", "col_missing"],
      client: {
        async listCollections(ids) {
          requested.push([...ids]);
          return [{ id: "col_rolls", name: "  Rolls  " }];
        },
      },
    });
    const key = collectionsCacheKey("loc_1");
    expect(requested).toEqual([["col_rolls", "col_missing"]]);
    expect(store.gets).toEqual([key]);
    expect(store.sets).toEqual([key]);
    expect(loaded.ok).toBe(true);
    expect(loaded.names.get("col_rolls")).toBe("Rolls");
    expect(loaded.names.get("col_missing")).toBeNull();
    expect(JSON.parse((await inner.get(key)) ?? "{}")).toEqual({ col_rolls: "Rolls", col_missing: null });

    store.gets.length = 0;
    store.sets.length = 0;
    const hit = await loadCollectionNames({
      store,
      locationId: "loc_1",
      ids: ["col_missing"],
      client: {
        async listCollections() {
          throw new Error("cache hit must not fetch");
        },
      },
    });
    expect(hit.ok).toBe(true);
    expect(hit.names.get("col_missing")).toBeNull();
    expect(store.gets).toEqual([key]);
    expect(store.sets).toEqual([]);

    now = COLLECTIONS_TTL_SECONDS * 1000;
    expect(await inner.get(key)).toBeNull();
    expect(COLLECTIONS_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it("fails open on a timeout without replacing a map that is already stored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const inner = new MemoryIdempotencyStore(() => 0);
      const key = collectionsCacheKey("loc_1");
      const existing = JSON.stringify({ col_rolls: "Rolls" });
      await inner.set(key, existing, COLLECTIONS_TTL_SECONDS);
      const loaded = await loadCollectionNames({
        store: inner,
        locationId: "loc_1",
        ids: ["col_rolls", "col_new"],
        client: {
          async listCollections() {
            throw new GhlRequestError("GHL request failed", 0, "/products/collections");
          },
        },
      });
      expect(loaded.ok).toBe(false);
      expect(await inner.get(key)).toBe(existing);
      const text = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("m06.collections_refresh_failed");
      expect(text).not.toContain("Bearer");
    } finally {
      warn.mockRestore();
    }
  });

  it("treats a corrupt cache entry as a miss", async () => {
    const inner = new MemoryIdempotencyStore(() => 0);
    await inner.set(collectionsCacheKey("loc_1"), "not-json", COLLECTIONS_TTL_SECONDS);
    const loaded = await loadCollectionNames({
      store: inner,
      locationId: "loc_1",
      ids: ["col_rolls"],
      client: {
        async listCollections() {
          return [{ id: "col_rolls", name: "Rolls" }];
        },
      },
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.names.get("col_rolls")).toBe("Rolls");
  });
});

describe("collections HTTP", () => {
  it("requests missing ids in pages of 100 and rejects a body that is not a list", async () => {
    const urls: string[] = [];
    const client = createGhlClient({
      apiKey: "super-secret-api-key-xyz",
      locationId: "loc_1",
      minIntervalMs: 0,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        expect(url).not.toContain("super-secret-api-key-xyz");
        const ids = new URL(url).searchParams.get("collectionIds")?.split(",") ?? [];
        return new Response(JSON.stringify({ data: ids.map((id) => ({ _id: id, name: `Name ${id}` })) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const ids = Array.from({ length: COLLECTIONS_PAGE_LIMIT + 1 }, (_, index) => `col_${index}`);
    const rows = await client.listCollections(ids);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0] ?? "").pathname).toBe("/products/collections");
    expect(new URL(urls[0] ?? "").searchParams.get("altId")).toBe("loc_1");
    expect(new URL(urls[0] ?? "").searchParams.get("altType")).toBe("location");
    expect(new URL(urls[0] ?? "").searchParams.get("limit")).toBe("100");
    expect(new URL(urls[0] ?? "").searchParams.get("collectionIds")?.split(",")).toHaveLength(100);
    expect(new URL(urls[1] ?? "").searchParams.get("collectionIds")).toBe("col_100");
    expect(rows).toHaveLength(101);
    expect(rows[0]).toEqual({ id: "col_0", name: "Name col_0" });
    expect(parseCollections({ data: [{ id: "c1", title: " Bowls " }, { name: "skip" }] })).toEqual([
      { id: "c1", name: "Bowls" },
    ]);
    expect(parseCollections({})).toBeNull();

    const broken = createGhlClient({
      apiKey: "super-secret-api-key-xyz",
      locationId: "loc_1",
      minIntervalMs: 0,
      maxRetries: 0,
      fetchImpl: async () => new Response(JSON.stringify({ collections: [] }), { status: 200 }),
    });
    await expect(broken.listCollections(["col_1"])).rejects.toMatchObject({ status: 200, path: "/products/collections" });
  });
});

describe("category fields on the recompute path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses one collections read on the next webhook and skips the fields when GHL times out", async () => {
    const line = { productId: "prod_1", name: "Roll", qty: 2, spend: 40, collectionIds: ["col_rolls"] };
    const listed = order({
      id: "o1",
      amount: 40,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "v1",
      sourceName: "STENZ STORE",
      sourceType: "website",
      sourceSubType: "store",
      items: [],
    });
    const detail = order({
      ...listed,
      deliveryMethod: "shipping",
      items: [line],
    });
    const idempotency = new MemoryIdempotencyStore(() => NOW.getTime());
    const store = new CountingStore(idempotency);
    let collectionCalls = 0;
    const updates: Array<Record<string, string>> = [];
    const client = contactClient(listed, detail, updates, async (ids) => {
      collectionCalls += 1;
      expect(ids).toEqual(["col_rolls"]);
      return [{ id: "col_rolls", name: "Rolls" }];
    });
    const cache = new MemoryOrderSummaryCache(() => NOW.getTime());
    const first = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: store,
      orderSummaries: cache,
    });
    expect(first.written).toBe(true);
    expect(collectionCalls).toBe(1);
    expect(updates[0]?.favorite_item).toBe("Roll");
    expect(updates[0]?.favorite_category).toBe("Rolls");
    expect(updates[0]?.top_categories).toBe("Rolls");
    expect(updates[0]?.category_diversity).toBe("1");
    expect(store.gets.filter((key) => key === collectionsCacheKey("loc_1"))).toEqual([collectionsCacheKey("loc_1")]);

    const getsBefore = store.gets.length;
    const second = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: store,
      orderSummaries: cache,
    });
    expect(second.written).toBe(false);
    expect(collectionCalls).toBe(1);
    expect(store.gets.slice(getsBefore).filter((key) => key.startsWith("m06:collections:"))).toEqual([
      collectionsCacheKey("loc_1"),
    ]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = contactClient(listed, detail, updates, async () => {
      throw new GhlRequestError("timeout Bearer super-secret-api-key-xyz", 0, "/products/collections");
    });
    const cold = new MemoryIdempotencyStore(() => NOW.getTime());
    const missed = await recomputeM06Contact({
      client: failing,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: cold,
      orderSummaries: new MemoryOrderSummaryCache(() => NOW.getTime()),
    });
    expect(missed.written).toBe(true);
    const last = updates[updates.length - 1] ?? {};
    expect(last.favorite_item).toBe("Roll");
    expect(last.favorite_category).toBeUndefined();
    expect(last.top_categories).toBeUndefined();
    expect(last.category_diversity).toBeUndefined();
    expect(await cold.get(collectionsCacheKey("loc_1"))).toBeNull();
    const text = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(text).toContain("m06.collections_refresh_failed");
    expect(text).not.toContain("super-secret-api-key-xyz");
  });
});

function contactClient(
  listed: ReturnType<typeof order>,
  detail: ReturnType<typeof order>,
  updates: Array<Record<string, string>>,
  listCollections: (ids: readonly string[]) => Promise<GhlCollection[]>,
): GhlClient {
  let storedHash: string | null = null;
  const hashId = fieldByKey("metrics_hash")?.testLabId ?? "hash";
  return {
    async listOrders() {
      return [listed];
    },
    async listLocationOrdersPage() {
      return { orders: [], totalCount: 0 };
    },
    async getOrder() {
      return detail;
    },
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
    listCollections,
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
