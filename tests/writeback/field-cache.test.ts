import { describe, expect, it } from "vitest";
import type { GhlClient } from "../../src/ghl/index.js";
import { GhlRequestError } from "../../src/ghl/errors.js";
import { MemoryIdempotencyStore } from "../../src/idempotency/index.js";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import {
  FIELD_CACHE_TTL_SECONDS,
  fieldCacheKey,
  invalidateFieldCache,
  isUnknownFieldError,
  loadFieldIdMap,
} from "../../src/writeback/field-cache.js";
import { writeM06Metrics } from "../../src/writeback/m06.js";
import { order } from "../helpers/orders.js";

describe("custom field id cache", () => {
  it("reuses the cached map for ten minutes and reloads after an unknown-field error", async () => {
    const store = new MemoryIdempotencyStore(() => 0);
    let lists = 0;
    let updates = 0;
    const client = {
      async listCustomFields() {
        lists += 1;
        return M06_WRITTEN_KEYS.map((key) => {
          const field = fieldByKey(key);
          if (!field) throw new Error(key);
          const id = lists === 1 && key === "total_orders" ? "stale" : field.testLabId;
          return { id, fieldKey: field.fieldKey, name: field.name, dataType: field.dataType };
        });
      },
      async getContact() {
        return { id: "c", customFields: [] };
      },
      async updateContact() {
        updates += 1;
        if (updates === 1) throw new GhlRequestError("GHL request failed with status 400", 400, "/contacts/c");
      },
    } as unknown as GhlClient;
    const first = await loadFieldIdMap(client, store, "loc_1");
    const second = await loadFieldIdMap(client, store, "loc_1");
    expect(first.get("total_orders")).toBe("stale");
    expect(second.get("total_orders")).toBe("stale");
    expect(lists).toBe(1);
    expect(await store.get(fieldCacheKey("loc_1"))).toContain("stale");
    expect(FIELD_CACHE_TTL_SECONDS).toBe(600);
    expect(isUnknownFieldError(new GhlRequestError("nope", 400, "/contacts/c"))).toBe(true);
    expect(isUnknownFieldError(new Error("Missing custom field contact.total_orders"))).toBe(true);

    await expect(
      writeM06Metrics({
        client,
        contactId: "c",
        orders: [order({ amount: 15, createdAt: "2026-01-11T00:00:00.000Z" })],
        timeZone: "UTC",
        now: new Date("2026-01-21T12:00:00.000Z"),
        fieldCache: { store, locationId: "loc_1" },
      }),
    ).resolves.toMatchObject({ written: true });
    expect(updates).toBe(2);
    expect(lists).toBe(2);
    expect(await store.get(fieldCacheKey("loc_1"))).toContain(fieldByKey("total_orders")?.testLabId);
    expect(await store.get(fieldCacheKey("loc_1"))).not.toContain("stale");
    await invalidateFieldCache(store, "loc_1");
    expect(await store.get(fieldCacheKey("loc_1"))).toBeNull();
  });
});
