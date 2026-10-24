import { describe, expect, it } from "vitest";
import { computeM06 } from "../../src/metrics";
import { order } from "../helpers/orders";

const NOW = new Date("2026-01-21T12:00:00.000Z");

describe("same-day intervals", () => {
  it("counts every order and collapses a calendar day to one interval point", () => {
    const metrics = computeM06(
      [
        order({ amount: 10, createdAt: "2026-01-01T08:00:00.000Z" }),
        order({ amount: 20, createdAt: "2026-01-01T18:00:00.000Z" }),
        order({ amount: 30, createdAt: "2026-01-11T12:00:00.000Z" }),
      ],
      "UTC",
      NOW,
    );
    expect(metrics.totalOrders).toBe(3);
    expect(metrics.qualifyingOrderCount).toBe(3);
    expect(metrics.lifetimeValue).toBe(60);
    expect(metrics.orderIntervalsDays).toEqual([10]);
    expect(metrics.averageOrderIntervalDays).toBe(10);
    expect(metrics.typicalOrderIntervalDays).toBe(10);
  });

  it("returns no interval, no typical gap, and an empty overdue ratio for one calendar day", () => {
    const metrics = computeM06(
      [
        order({ createdAt: "2026-01-01T08:00:00.000Z" }),
        order({ createdAt: "2026-01-01T12:00:00.000Z" }),
        order({ createdAt: "2026-01-01T18:00:00.000Z" }),
      ],
      "UTC",
      NOW,
    );
    expect(metrics.totalOrders).toBe(3);
    expect(metrics.qualifyingOrderCount).toBe(3);
    expect(metrics.orderIntervalsDays).toEqual([]);
    expect(metrics.averageOrderIntervalDays).toBeNull();
    expect(metrics.typicalOrderIntervalDays).toBeNull();
    expect(metrics.overdueRatio).toBeNull();
    expect(metrics.daysOverdue).toBeNull();
    expect(metrics.expectedNextOrderDate).toBeNull();
  });

  it("uses the mean for average and the median for typical", () => {
    const metrics = computeM06(
      [
        order({ createdAt: "2026-01-01T00:00:00.000Z" }),
        order({ createdAt: "2026-01-04T00:00:00.000Z" }),
        order({ createdAt: "2026-01-08T00:00:00.000Z" }),
        order({ createdAt: "2026-01-18T00:00:00.000Z" }),
      ],
      "UTC",
      NOW,
    );
    expect(metrics.orderIntervalsDays).toEqual([3, 4, 10]);
    expect(metrics.averageOrderIntervalDays).toBe(5.67);
    expect(metrics.typicalOrderIntervalDays).toBe(4);
  });

  it("collapses orders that fall on the same tenant-local day", () => {
    const metrics = computeM06(
      [
        order({ createdAt: "2026-01-01T22:30:00.000Z" }),
        order({ createdAt: "2026-01-02T20:30:00.000Z" }),
      ],
      "Africa/Cairo",
      NOW,
    );
    expect(metrics.totalOrders).toBe(2);
    expect(metrics.firstOrderDate).toBe("2026-01-02");
    expect(metrics.lastOrderDate).toBe("2026-01-02");
    expect(metrics.orderIntervalsDays).toEqual([]);
  });
});
