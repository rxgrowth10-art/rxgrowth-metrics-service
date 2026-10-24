import { describe, expect, it } from "vitest";
import { computeM06, customerStatus, lifecycleStage } from "../../src/metrics";
import { addCalendarDays } from "../../src/time/business-date";
import { order } from "../helpers/orders";

const TODAY = "2026-06-01";
const NOW = new Date(`${TODAY}T12:00:00.000Z`);

function atAge(days: number, extra: ReturnType<typeof order>[] = []): ReturnType<typeof computeM06> {
  const last = addCalendarDays(TODAY, -days);
  const earlier = addCalendarDays(TODAY, -days - 10);
  if (!last || !earlier) throw new Error("bad date");
  return computeM06(
    [
      order({ createdAt: `${earlier}T12:00:00.000Z`, amount: 40 }),
      order({ createdAt: `${last}T12:00:00.000Z`, amount: 50, sourceSubType: "delivery" }),
      ...extra,
    ],
    "UTC",
    NOW,
  );
}

describe("lifecycle and customer status", () => {
  it("follows the M06 recency bands and labels the last band LOST", () => {
    expect(lifecycleStage(0, null)).toBe("NO QUALIFYING ORDERS");
    expect(lifecycleStage(1, 400)).toBe("NEW");
    expect(atAge(0).lifecycleStage).toBe("ACTIVE");
    expect(atAge(30).lifecycleStage).toBe("ACTIVE");
    expect(atAge(31).lifecycleStage).toBe("ACTIVE-COOLING");
    expect(atAge(60).lifecycleStage).toBe("ACTIVE-COOLING");
    expect(atAge(61).lifecycleStage).toBe("AT RISK");
    expect(atAge(90).lifecycleStage).toBe("AT RISK");
    expect(atAge(91).lifecycleStage).toBe("LAPSED");
    expect(atAge(180).lifecycleStage).toBe("LAPSED");
    expect(atAge(181).lifecycleStage).toBe("LOST");
  });

  it("keeps a single qualifying order NEW and a lead without orders", () => {
    const single = computeM06([order({ createdAt: "2025-01-01T00:00:00.000Z" })], "UTC", NOW);
    expect(single.lifecycleStage).toBe("NEW");
    expect(single.customerType).toBe("Customer");
    expect(single.customerStatus).toBe("New");
    const none = computeM06([], "UTC", NOW);
    expect(none.lifecycleStage).toBe("NO QUALIFYING ORDERS");
    expect(none.customerType).toBe("Lead");
    expect(none.customerStatus).toBe("New");
    expect(customerStatus(2, 60)).toBe("Active");
    expect(customerStatus(2, 61)).toBe("At Risk");
    expect(customerStatus(2, 91)).toBe("Lapsed");
    expect(customerStatus(2, 181)).toBe("Lost");
  });

  it("rounds days overdue to two decimals and leaves the ratio empty without a typical interval", () => {
    const metrics = atAge(10);
    expect(metrics.orderIntervalsDays).toEqual([10]);
    expect(metrics.typicalOrderIntervalDays).toBe(10);
    expect(metrics.daysSinceLastOrder).toBe(10);
    expect(metrics.daysOverdue).toBe(0);
    expect(metrics.overdueRatio).toBe(1);
    const ratio = computeM06(
      [
        order({ createdAt: "2026-05-15T00:00:00.000Z", amount: 10 }),
        order({ createdAt: "2026-05-18T00:00:00.000Z", amount: 10 }),
        order({ createdAt: "2026-05-22T00:00:00.000Z", amount: 10 }),
        order({ createdAt: "2026-05-25T00:00:00.000Z", amount: 10 }),
      ],
      "UTC",
      NOW,
    );
    expect(ratio.orderIntervalsDays).toEqual([3, 4, 3]);
    expect(ratio.typicalOrderIntervalDays).toBe(3);
    expect(ratio.daysSinceLastOrder).toBe(7);
    expect(ratio.daysOverdue).toBe(4);
    expect(ratio.overdueRatio).toBe(2.33);
  });
});
