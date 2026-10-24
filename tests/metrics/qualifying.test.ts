import { describe, expect, it } from "vitest";
import { isQualifyingOrder } from "../../src/metrics/index.js";
import { order } from "../helpers/orders.js";

describe("qualifying orders", () => {
  it("accepts paid, COD unpaid, and partially paid orders", () => {
    expect(isQualifyingOrder(order({ paymentStatus: "paid" }))).toBe(true);
    expect(isQualifyingOrder(order({ paymentStatus: "unpaid", status: "pending fulfilment" }))).toBe(true);
    expect(isQualifyingOrder(order({ paymentStatus: "UNPAID", status: "unfulfilled", amount: "18.5" }))).toBe(true);
    expect(isQualifyingOrder(order({ paymentStatus: "partially_paid" }))).toBe(true);
  });

  it("rejects cancelled, refunded, test, non-live, and zero-amount orders", () => {
    expect(isQualifyingOrder(order({ status: "cancelled" }))).toBe(false);
    expect(isQualifyingOrder(order({ status: "CANCELLED" }))).toBe(false);
    expect(isQualifyingOrder(order({ status: "refunded", paymentStatus: "paid" }))).toBe(false);
    expect(isQualifyingOrder(order({ status: " REFUNDED " }))).toBe(false);
    expect(isQualifyingOrder(order({ status: "partially_refunded", paymentStatus: "paid" }))).toBe(false);
    expect(isQualifyingOrder(order({ status: "Partially_Refunded" }))).toBe(false);
    expect(isQualifyingOrder(order({ paymentStatus: "refunded" }))).toBe(false);
    expect(isQualifyingOrder(order({ paymentStatus: "partially_refunded" }))).toBe(false);
    expect(isQualifyingOrder(order({ markAsTest: true }))).toBe(false);
    expect(isQualifyingOrder(order({ markAsTest: null, paymentStatus: "unpaid" }))).toBe(true);
    expect(isQualifyingOrder(order({ paymentStatus: null }))).toBe(false);
    expect(isQualifyingOrder(order({ liveMode: false }))).toBe(false);
    expect(isQualifyingOrder(order({ liveMode: null }))).toBe(false);
    expect(isQualifyingOrder(order({ amount: 0 }))).toBe(false);
    expect(isQualifyingOrder(order({ amount: -5 }))).toBe(false);
    expect(isQualifyingOrder(order({ paymentStatus: "failed" }))).toBe(false);
    expect(isQualifyingOrder(null)).toBe(false);
  });

  it("does not let fulfillment status disqualify an otherwise live order", () => {
    expect(
      isQualifyingOrder(
        order({ status: "completed", fulfillmentStatus: "cancelled", paymentStatus: "paid" }),
      ),
    ).toBe(true);
    expect(
      isQualifyingOrder(
        order({ status: "unfulfilled", fulfillmentStatus: "unfulfilled", paymentStatus: "unpaid" }),
      ),
    ).toBe(true);
  });
});
