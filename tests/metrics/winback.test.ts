import { describe, expect, it } from "vitest";
import { computeM06, evaluateWinback } from "../../src/metrics/index.js";
import { order } from "../helpers/orders.js";

describe("win-back eligibility", () => {
  it("requires 3 qualifying orders, 21 days, and an overdue ratio of at least 1.5", () => {
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 21, typicalOrderIntervalDays: 14 })).toEqual({
      eligible: true,
      eligibility: "Eligible",
      tier: "Medium",
      overdueRatio: 1.5,
    });
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 28, typicalOrderIntervalDays: 14 })).toMatchObject({
      eligible: true,
      tier: "High",
      overdueRatio: 2,
    });
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 27, typicalOrderIntervalDays: 14 })).toMatchObject({
      eligible: true,
      tier: "Medium",
      overdueRatio: 1.93,
    });
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 20, typicalOrderIntervalDays: 10 })).toMatchObject({
      eligible: false,
      eligibility: "Not Eligible",
      tier: "None",
    });
    expect(evaluateWinback({ qualifyingOrderCount: 2, daysSinceLastOrder: 40, typicalOrderIntervalDays: 10 })).toMatchObject({
      eligible: false,
      tier: "None",
      overdueRatio: 4,
    });
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 30, typicalOrderIntervalDays: 0 }).eligible).toBe(false);
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 30, typicalOrderIntervalDays: null }).eligible).toBe(false);
    expect(evaluateWinback({ qualifyingOrderCount: 3, daysSinceLastOrder: 21, typicalOrderIntervalDays: 20 })).toMatchObject({
      eligible: false,
      overdueRatio: 1.05,
    });
  });

  it("is not eligible when every qualifying order falls on one calendar day", () => {
    const metrics = computeM06(
      [
        order({ createdAt: "2026-01-01T08:00:00.000Z" }),
        order({ createdAt: "2026-01-01T12:00:00.000Z" }),
        order({ createdAt: "2026-01-01T18:00:00.000Z" }),
      ],
      "UTC",
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(metrics.qualifyingOrderCount).toBe(3);
    expect(metrics.orderIntervalsDays).toEqual([]);
    expect(metrics.typicalOrderIntervalDays).toBeNull();
    expect(metrics.overdueRatio).toBeNull();
    expect(
      evaluateWinback({
        qualifyingOrderCount: metrics.qualifyingOrderCount,
        daysSinceLastOrder: metrics.daysSinceLastOrder,
        typicalOrderIntervalDays: metrics.typicalOrderIntervalDays,
      }),
    ).toMatchObject({ eligible: false, eligibility: "Not Eligible", tier: "None", overdueRatio: null });
  });
});
