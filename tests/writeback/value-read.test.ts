import { describe, expect, it } from "vitest";
import { VALUE_DISTRIBUTION_TTL_SECONDS, valueDistributionKey } from "../../src/cron/distribution.js";
import type { CustomFieldWrite, GhlClient, GhlContact } from "../../src/ghl/index.js";
import { MemoryIdempotencyStore } from "../../src/idempotency/index.js";
import { serializeValueDistribution } from "../../src/metrics/value.js";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import { recomputeM06Contact } from "../../src/writeback/recompute.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-01-11T12:00:00.000Z");

describe("webhook value distribution read", () => {
  it("reads the location key once and does not search contacts", async () => {
    const store = new MemoryIdempotencyStore(() => NOW.getTime());
    await store.set(
      valueDistributionKey("loc_1"),
      serializeValueDistribution({
        spend: Array.from({ length: 10 }, () => 1),
        orders: Array.from({ length: 10 }, () => 10),
        scores: Array.from({ length: 10 }, () => 0),
      }),
      VALUE_DISTRIBUTION_TTL_SECONDS,
    );
    const gets: string[] = [];
    const read = store.get.bind(store);
    store.get = async (key) => {
      gets.push(key);
      return read(key);
    };
    let searches = 0;
    const updates: Array<Record<string, string>> = [];
    let storedHash: string | null = null;
    const hashId = fieldByKey("metrics_hash")?.testLabId ?? "hash";
    const listed = [order({ id: "order_1", amount: 25.5, createdAt: "2026-01-01T12:00:00.000Z", deliveryMethod: "shipping" })];
    const client: GhlClient = {
      async listOrders() {
        return listed;
      },
      async listLocationOrdersPage() {
        return { orders: [], totalCount: 0 };
      },
      async getOrder() {
        return listed[0] ?? null;
      },
      async getContact(): Promise<GhlContact> {
        return {
          id: "contact_1",
          customFields: storedHash ? [{ id: hashId, key: "metrics_hash", value: storedHash }] : [],
        };
      },
      async listCustomFields() {
        return M06_WRITTEN_KEYS.map((key) => {
          const field = fieldByKey(key);
          if (!field) throw new Error(key);
          return { id: field.testLabId, fieldKey: field.fieldKey, name: field.name, dataType: field.dataType };
        });
      },
      async updateContact(_contactId, fields: CustomFieldWrite[]) {
        updates.push(Object.fromEntries(fields.map((field) => [field.key, field.value])));
        storedHash = fields.find((field) => field.key === "metrics_hash")?.value ?? storedHash;
      },
      async searchContacts() {
        searches += 1;
        throw new Error("webhook must not search contacts");
      },
      async searchContactsPage() {
        searches += 1;
        throw new Error("webhook must not search contacts");
      },
      async listCollections() {
        return [];
      },
      async addContactToWorkflow() {
        return undefined;
      },
    };

    const first = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: store,
    });
    const second = await recomputeM06Contact({
      client,
      contactId: "contact_1",
      locationId: "loc_1",
      timeZone: "UTC",
      now: NOW,
      idempotency: store,
    });
    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(searches).toBe(0);
    expect(gets.filter((key) => key.startsWith("m10:dist"))).toEqual(["m10:dist:loc_1", "m10:dist:loc_1"]);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.lifetime_spend_percentile).toBe("100.00");
    expect(updates[0]?.vip_status).toBe("VIP");
    expect(updates[0]?.customer_value_score).toBe("60.00");
  });
});
