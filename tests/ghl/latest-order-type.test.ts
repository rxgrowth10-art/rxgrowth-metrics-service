import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applyLatestOrderDetail, MAX_LATEST_ORDER_DETAIL_CALLS } from "../../src/ghl/latest-order-detail";
import { parseOrderResource } from "../../src/ghl/parse";
import type { GhlOrder } from "../../src/ghl/types";
import { computeM06 } from "../../src/metrics";
import { metricsHash } from "../../src/writeback/hash";
import { coerceLastOrderType, formatM06Values } from "../../src/writeback/format";
import { order } from "../helpers/orders";

const NOW = new Date("2026-10-24T12:00:00.000Z");

function fixture(name: string): GhlOrder {
  const body = JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8")) as unknown;
  const parsed = parseOrderResource(body);
  if (!parsed) throw new Error(name);
  return parsed;
}

function listed(id: string, createdAt: string): GhlOrder {
  return order({
    id,
    createdAt,
    sourceSubType: "store",
    deliveryMethod: null,
    markAsTest: null,
    paymentStatus: "paid",
    liveMode: true,
    amount: 40,
  });
}

describe("latest order checkout type", () => {
  it("maps shipping and pickup from order detail and ignores fees and payment names", async () => {
    const shipping = fixture("order-detail-shipping.json");
    const pickup = fixture("order-detail-pickup.json");
    const bare = fixture("order-detail-no-delivery.json");
    expect(shipping.deliveryMethod).toBe("shipping");
    expect(pickup.deliveryMethod).toBe("pickup");
    expect(bare.deliveryMethod).toBeNull();
    expect(coerceLastOrderType("shipping")).toBe("Delivery");
    expect(coerceLastOrderType("PICKUP")).toBe("Pickup");
    expect(coerceLastOrderType("store")).toBe("");
    expect(coerceLastOrderType("dine_in")).toBe("");
    expect(coerceLastOrderType("Cash on Delivery")).toBe("");

    const shipped = await applyLatestOrderDetail([listed("order_detail_shipping", "2026-10-21T18:47:57.185Z")], async () => shipping);
    expect(computeM06(shipped, "Africa/Cairo", NOW).lastOrderType).toBe("shipping");
    expect(coerceLastOrderType(computeM06(shipped, "Africa/Cairo", NOW).lastOrderType)).toBe("Delivery");

    const picked = await applyLatestOrderDetail([listed("order_detail_pickup", "2026-10-21T16:00:00.000Z")], async () => pickup);
    expect(coerceLastOrderType(computeM06(picked, "Africa/Cairo", NOW).lastOrderType)).toBe("Pickup");

    const omitted = await applyLatestOrderDetail([listed("order_detail_no_delivery", "2026-10-21T12:00:00.000Z")], async () => bare);
    expect(computeM06(omitted, "Africa/Cairo", NOW).lastOrderType).toBeNull();
    expect(coerceLastOrderType(computeM06(omitted, "Africa/Cairo", NOW).lastOrderType)).toBe("");
  });

  it("omits last_order_type when the detail call fails and does not log the payload", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const orders = await applyLatestOrderDetail([listed("order_fail", "2026-10-21T12:00:00.000Z")], async () => {
        throw new Error('status 500 {"contactSnapshot":{"email":"secret@example.test"}}');
      });
      const metrics = computeM06(orders, "UTC", NOW);
      expect(metrics.qualifyingOrderCount).toBe(1);
      expect(metrics.lastOrderType).toBeNull();
      expect(coerceLastOrderType(metrics.lastOrderType)).toBe("");
      const text = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("m06.latest_order_detail_failed");
      expect(text).toContain("order_fail");
      expect(text).not.toContain("contactSnapshot");
      expect(text).not.toContain("secret@example.test");
    } finally {
      warn.mockRestore();
    }
  });

  it("skips a detail marked as a test and uses the next latest checkout choice", async () => {
    const tested = fixture("order-detail-mark-as-test.json");
    const pickup = fixture("order-detail-pickup.json");
    const seen: string[] = [];
    const orders = await applyLatestOrderDetail(
      [
        listed("order_detail_test", "2026-10-22T12:00:00.000Z"),
        listed("order_detail_pickup", "2026-10-21T16:00:00.000Z"),
      ],
      async (orderId) => {
        seen.push(orderId);
        if (orderId === "order_detail_test") return tested;
        return pickup;
      },
    );
    expect(seen).toEqual(["order_detail_test", "order_detail_pickup"]);
    const metrics = computeM06(orders, "UTC", NOW);
    expect(metrics.qualifyingOrderCount).toBe(1);
    expect(metrics.lifetimeValue).toBe(40);
    expect(coerceLastOrderType(metrics.lastOrderType)).toBe("Pickup");
  });

  it("stops after three detail calls when each latest order is a test", async () => {
    expect(MAX_LATEST_ORDER_DETAIL_CALLS).toBe(3);
    const seen: string[] = [];
    const orders = await applyLatestOrderDetail(
      [
        listed("t1", "2026-10-24T12:00:00.000Z"),
        listed("t2", "2026-10-23T12:00:00.000Z"),
        listed("t3", "2026-10-22T12:00:00.000Z"),
        listed("keep", "2026-10-21T12:00:00.000Z"),
      ],
      async (orderId) => {
        seen.push(orderId);
        return order({ id: orderId, markAsTest: true, deliveryMethod: "shipping" });
      },
    );
    expect(seen).toEqual(["t1", "t2", "t3"]);
    const metrics = computeM06(orders, "UTC", NOW);
    expect(metrics.qualifyingOrderCount).toBe(1);
    expect(metrics.lastOrderType).toBeNull();
  });

  it("includes last_order_type in the metrics hash even when the write omits it", () => {
    const without = formatM06Values(
      computeM06([order({ id: "a", deliveryMethod: null, createdAt: "2026-10-21T12:00:00.000Z" })], "UTC", NOW),
    );
    const withDelivery = formatM06Values(
      computeM06([order({ id: "a", deliveryMethod: "shipping", createdAt: "2026-10-21T12:00:00.000Z" })], "UTC", NOW),
    );
    expect(without.last_order_type).toBe("");
    expect(withDelivery.last_order_type).toBe("Delivery");
    expect(metricsHash(without)).not.toBe(metricsHash(withDelivery));
    const dropped = { ...withDelivery };
    delete dropped.last_order_type;
    expect(metricsHash(dropped)).not.toBe(metricsHash(withDelivery));
  });
});
