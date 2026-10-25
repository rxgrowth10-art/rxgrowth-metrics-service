import { describe, expect, it } from "vitest";
import type { CustomFieldWrite, GhlClient, GhlContact } from "../../src/ghl/index.js";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import { coerceLastOrderType } from "../../src/writeback/format.js";
import { metricsHash } from "../../src/writeback/hash.js";
import { writeM06Metrics } from "../../src/writeback/m06.js";
import { order } from "../helpers/orders.js";

function fieldCatalog() {
  return M06_WRITTEN_KEYS.map((key) => {
    const field = fieldByKey(key);
    if (!field) throw new Error(`missing ${key}`);
    return { id: field.testLabId, fieldKey: field.fieldKey, name: field.name, dataType: field.dataType };
  });
}

function clientWith(orders = [order({ amount: 25.5, deliveryMethod: "shipping" })]) {
  const updates: CustomFieldWrite[][] = [];
  let storedHash: string | null = null;
  const hashId = fieldByKey("metrics_hash")?.testLabId ?? "hash";
  const client: GhlClient = {
    async listOrders() {
      return orders;
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
  return { client, updates, readHash: () => storedHash };
}

const NOW = new Date("2026-01-11T12:00:00.000Z");

describe("M06 writeback", () => {
  it("writes the M06 contract, including the new fields, and skips win-back fields", async () => {
    const { client, updates } = clientWith();
    const result = await writeM06Metrics({
      client,
      contactId: "contact_1",
      orders: [order({ amount: 25.5, deliveryMethod: "shipping", createdAt: "2026-01-01T12:00:00.000Z" })],
      timeZone: "UTC",
      now: NOW,
    });
    expect(result.written).toBe(true);
    const fields = updates[0] ?? [];
    expect(fields.map((field) => field.key)).toEqual([...M06_WRITTEN_KEYS]);
    expect(fields.some((field) => field.key.startsWith("winback_"))).toBe(false);
    const value = (key: string) => fields.find((field) => field.key === key)?.value;
    expect(value("total_orders")).toBe("1");
    expect(value("qualifying_order_count")).toBe("1");
    expect(value("lifetime_value")).toBe("25.50");
    expect(value("lifecycle_stage")).toBe("NEW");
    expect(value("last_order_type")).toBe("Delivery");
    expect(value("metrics_hash")).toBe(result.hash);
    expect(value("m06_intelligence_updated_at")).toBe("2026-01-11");
    expect(value("days_overdue")).toBe("");
    expect(value("overdue_ratio")).toBe("");
  });

  it("skips the contact update when the metrics hash is unchanged", async () => {
    const orders = [
      order({ amount: 10, createdAt: "2026-01-01T08:00:00.000Z" }),
      order({ amount: 20, createdAt: "2026-01-01T18:00:00.000Z" }),
      order({ amount: 30, createdAt: "2026-01-11T12:00:00.000Z" }),
    ];
    const { client, updates } = clientWith(orders);
    const first = await writeM06Metrics({
      client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
    });
    const second = await writeM06Metrics({
      client,
      contactId: "contact_1",
      orders,
      timeZone: "UTC",
      now: NOW,
    });
    expect(first.written).toBe(true);
    expect(second).toEqual({ written: false, hash: first.hash, reason: "unchanged" });
    expect(updates).toHaveLength(1);
    const changed = [
      order({ amount: 10, createdAt: "2026-01-01T08:00:00.000Z" }),
      order({ amount: 20, createdAt: "2026-01-01T18:00:00.000Z" }),
      order({ amount: 40, createdAt: "2026-01-11T12:00:00.000Z" }),
    ];
    const third = await writeM06Metrics({
      client,
      contactId: "contact_1",
      orders: changed,
      timeZone: "UTC",
      now: NOW,
    });
    expect(third.written).toBe(true);
    expect(third.hash).not.toBe(first.hash);
    expect(updates).toHaveLength(2);
  });

  it("writes total_orders as the qualifying count and NO QUALIFYING ORDERS when nothing qualifies", async () => {
    const mixed = clientWith();
    await writeM06Metrics({
      client: mixed.client,
      contactId: "contact_1",
      orders: [
        order({ amount: 15, paymentStatus: "unpaid", createdAt: "2026-01-01T12:00:00.000Z" }),
        order({ amount: 40, paymentStatus: "refunded", createdAt: "2026-01-02T12:00:00.000Z" }),
        order({ amount: 5, status: "cancelled", createdAt: "2026-01-03T12:00:00.000Z" }),
      ],
      timeZone: "UTC",
      now: NOW,
    });
    const mixedValue = (key: string) => mixed.updates[0]?.find((field) => field.key === key)?.value;
    expect(mixedValue("total_orders")).toBe("1");
    expect(mixedValue("qualifying_order_count")).toBe("1");
    expect(mixedValue("lifetime_value")).toBe("15.00");

    const none = clientWith();
    await writeM06Metrics({
      client: none.client,
      contactId: "contact_1",
      orders: [order({ amount: 10, markAsTest: true })],
      timeZone: "UTC",
      now: NOW,
    });
    const noneValue = (key: string) => none.updates[0]?.find((field) => field.key === key)?.value;
    expect(noneValue("total_orders")).toBe("0");
    expect(noneValue("qualifying_order_count")).toBe("0");
    expect(noneValue("lifecycle_stage")).toBe("NO QUALIFYING ORDERS");
  });

  it("writes last_order_type only for checkout shipping or pickup", async () => {
    expect(coerceLastOrderType("shipping")).toBe("Delivery");
    expect(coerceLastOrderType("pickup")).toBe("Pickup");
    expect(coerceLastOrderType("dine_in")).toBe("");
    expect(coerceLastOrderType("store")).toBe("");
    expect(coerceLastOrderType("  ")).toBe("");

    const unmapped = clientWith();
    await writeM06Metrics({
      client: unmapped.client,
      contactId: "contact_1",
      orders: [order({ sourceSubType: "store", deliveryMethod: null, createdAt: "2026-01-01T12:00:00.000Z" })],
      timeZone: "UTC",
      now: NOW,
    });
    const fields = unmapped.updates[0] ?? [];
    expect(fields.map((field) => field.key)).toEqual(M06_WRITTEN_KEYS.filter((key) => key !== "last_order_type"));
    expect(fields.some((field) => field.key === "last_order_type")).toBe(false);
    expect(fields.find((field) => field.key === "metrics_hash")?.value).toBe(
      metricsHash({ ...Object.fromEntries(fields.map((field) => [field.key, field.value])), last_order_type: "" }),
    );

    const mapped = clientWith();
    await writeM06Metrics({
      client: mapped.client,
      contactId: "contact_1",
      orders: [order({ deliveryMethod: "pickup", createdAt: "2026-01-01T12:00:00.000Z" })],
      timeZone: "UTC",
      now: NOW,
    });
    expect(mapped.updates[0]?.find((field) => field.key === "last_order_type")?.value).toBe("Pickup");
  });

  it("writes an empty last_order_location when the order has no branch and no source name", async () => {
    const none = clientWith();
    await writeM06Metrics({
      client: none.client,
      contactId: "contact_1",
      orders: [order({ sourceName: null, branchName: null, deliveryMethod: null, createdAt: "2026-01-01T12:00:00.000Z" })],
      timeZone: "UTC",
      now: NOW,
    });
    const fields = none.updates[0] ?? [];
    expect(fields.some((field) => field.key === "last_order_location")).toBe(true);
    expect(fields.find((field) => field.key === "last_order_location")?.value).toBe("");
  });

  it("hashes the written values independent of key order and ignores the timestamp", () => {
    const left = metricsHash({ b: "2", a: "1", m06_intelligence_updated_at: "2026-01-01" });
    const right = metricsHash({ a: "1", b: "2", m06_intelligence_updated_at: "2026-02-02" });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });
});
