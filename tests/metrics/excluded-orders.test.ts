import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOrderPage } from "../../src/ghl/parse.js";
import { computeM06, isQualifyingOrder } from "../../src/metrics/index.js";
import { order } from "../helpers/orders.js";

function loadOrder(name: string) {
  const body = JSON.parse(readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), "utf8")) as unknown;
  const parsed = parseOrderPage(body).orders[0];
  if (!parsed) throw new Error(name);
  return parsed;
}

const cancelled = loadOrder("order-status-cancelled");
const statusRefunded = loadOrder("order-status-refunded");
const paymentRefunded = loadOrder("order-payment-refunded");

describe("excluded order fixtures", () => {
  it("keeps cancelled, status-refunded, and payment-refunded orders out of count and LTV", () => {
    expect(cancelled).toMatchObject({ id: "order_status_cancelled", status: "cancelled", paymentStatus: "paid", amount: 50 });
    expect(statusRefunded).toMatchObject({ id: "order_status_refunded", status: "refunded", paymentStatus: "paid", amount: 40 });
    expect(paymentRefunded).toMatchObject({
      id: "order_payment_refunded",
      status: "completed",
      paymentStatus: "refunded",
      amount: 25,
    });
    expect(isQualifyingOrder(cancelled)).toBe(false);
    expect(isQualifyingOrder(statusRefunded)).toBe(false);
    expect(isQualifyingOrder(paymentRefunded)).toBe(false);
    const metrics = computeM06(
      [cancelled, statusRefunded, paymentRefunded, order({ id: "keep", amount: 100, createdAt: "2026-01-01T12:00:00.000Z" })],
      "UTC",
      new Date("2026-06-22T12:00:00.000Z"),
    );
    expect(metrics.qualifyingOrderCount).toBe(1);
    expect(metrics.totalOrders).toBe(1);
    expect(metrics.lifetimeValue).toBe(100);
  });
});
