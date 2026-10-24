import { describe, expect, it } from "vitest";
import { calculateTrend, computeM06, frequencyBucket, summarizeValue } from "../../src/metrics";
import { order } from "../helpers/orders";

describe("value, frequency, and trends", () => {
  it("sums qualifying amounts only and rounds money to two decimals", () => {
    const summary = summarizeValue([order({ amount: 10 }), order({ amount: "20.5" })]);
    expect(summary.lifetimeValue).toBe(30.5);
    expect(summary.averageOrderValue).toBe(15.25);
    expect(summary.highestOrderValue).toBe(20.5);
    expect(summary.lowestOrderValue).toBe(10);
  });

  it("compares the last 30 days with the previous 30", () => {
    const metrics = computeM06(
      [
        order({ createdAt: "2026-06-01T00:00:00.000Z", amount: 30 }),
        order({ createdAt: "2026-05-20T00:00:00.000Z", amount: 10 }),
        order({ createdAt: "2026-04-15T00:00:00.000Z", amount: 50 }),
        order({ createdAt: "2025-01-01T00:00:00.000Z", amount: 5, paymentStatus: "refunded" }),
      ],
      "UTC",
      new Date("2026-06-01T12:00:00.000Z"),
    );
    expect(metrics.qualifyingOrderCount).toBe(3);
    expect(metrics.excludedOrderCount).toBe(1);
    expect(metrics.ordersLast30Days).toBe(2);
    expect(metrics.ordersPrevious30Days).toBe(1);
    expect(metrics.spendLast30Days).toBe(40);
    expect(metrics.spendPrevious30Days).toBe(50);
    expect(metrics.orderFrequencyTrend).toBe("Increasing");
    expect(metrics.spendingTrend).toBe("Decreasing");
    expect(metrics.frequencyBucket).toBe("Repeat");
    expect(calculateTrend(10, 10, 1, 1)).toBe("Stable");
    expect(calculateTrend(10, 5, 0, 2)).toBe("Insufficient Data");
    expect(frequencyBucket(0)).toBe("No Orders");
    expect(frequencyBucket(1)).toBe("First-Time");
    expect(frequencyBucket(9)).toBe("Regular");
    expect(frequencyBucket(10)).toBe("Frequent");
  });
});
