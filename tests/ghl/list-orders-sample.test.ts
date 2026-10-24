import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOrderPage } from "../../src/ghl/parse";
import { orderNeedsDetail } from "../../src/ghl/hydrate-orders";
import { computeM06, isQualifyingOrder } from "../../src/metrics";
import { coerceLastOrderType } from "../../src/writeback/format";

const sample = JSON.parse(readFileSync(new URL("../../fixtures/list-orders-sample.json", import.meta.url), "utf8")) as unknown;

describe("live list-orders shape", () => {
  it("qualifies unpaid storefront orders and omits an unmapped last order type", () => {
    const page = parseOrderPage(sample);
    expect(page.totalCount).toBe(2);
    const [first, second] = page.orders;
    expect(first).toMatchObject({
      id: "order_sample_1",
      contactId: "contact_sample",
      currency: "EGP",
      amount: 93.5,
      status: "completed",
      paymentStatus: "unpaid",
      liveMode: true,
      markAsTest: null,
      sourceSubType: "store",
      fulfillmentStatus: "unfulfilled",
      createdAt: "2026-10-21T18:47:57.185Z",
    });
    expect(orderNeedsDetail(first!)).toBe(false);
    expect(isQualifyingOrder(first)).toBe(true);
    expect(isQualifyingOrder(second)).toBe(true);
    const metrics = computeM06(page.orders, "Africa/Cairo", new Date("2026-10-24T12:00:00.000Z"));
    expect(metrics.totalOrders).toBe(metrics.qualifyingOrderCount);
    expect(metrics.totalOrders).toBe(2);
    expect(metrics.lifetimeValue).toBe(133.5);
    expect(metrics.lastOrderType).toBeNull();
    expect(coerceLastOrderType(metrics.lastOrderType)).toBe("");
  });
});
