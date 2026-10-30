import { describe, expect, it } from "vitest";
import { computeM06 } from "../../src/metrics/compute.js";
import {
  CONSISTENCY_WEIGHT,
  EMERGING_VIP_MIN_SCORE,
  FREQUENCY_WEIGHT,
  RECENCY_WEIGHT,
  SPEND_WEIGHT,
  VIP_MIN_CUSTOMERS,
  VIP_PERCENTILE,
  buildValueDistribution,
  consistencyScore,
  customerValueScore,
  isVip,
  percentileRank,
  recencyScore,
  serializeValueDistribution,
  valueFieldValues,
  vipClassification,
  type ValueDistribution,
} from "../../src/metrics/value.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-01-11T12:00:00.000Z");

function repeat(count: number, value: number): number[] {
  return Array.from({ length: count }, () => value);
}

describe("value score", () => {
  it("uses the 40/25/20/15 weights and rounds to two decimals", () => {
    expect(SPEND_WEIGHT).toBe(0.4);
    expect(FREQUENCY_WEIGHT).toBe(0.25);
    expect(RECENCY_WEIGHT).toBe(0.2);
    expect(CONSISTENCY_WEIGHT).toBe(0.15);
    expect(SPEND_WEIGHT + FREQUENCY_WEIGHT + RECENCY_WEIGHT + CONSISTENCY_WEIGHT).toBe(1);
    expect(
      customerValueScore({
        spendPercentile: 80,
        frequencyPercentile: 40,
        recency: 100,
        consistency: 75,
      }),
    ).toBe(73.25);
    expect(
      customerValueScore({
        spendPercentile: 33.33,
        frequencyPercentile: 0,
        recency: 0,
        consistency: 0,
      }),
    ).toBe(13.33);
  });

  it("maps recency bands on the day boundaries and consistency labels", () => {
    expect(recencyScore(null)).toBe(0);
    expect(recencyScore(0)).toBe(100);
    expect(recencyScore(30)).toBe(100);
    expect(recencyScore(31)).toBe(75);
    expect(recencyScore(60)).toBe(75);
    expect(recencyScore(61)).toBe(50);
    expect(recencyScore(90)).toBe(50);
    expect(recencyScore(91)).toBe(25);
    expect(recencyScore(180)).toBe(25);
    expect(recencyScore(181)).toBe(0);
    expect(consistencyScore("Highly Consistent")).toBe(100);
    expect(consistencyScore("Consistent")).toBe(75);
    expect(consistencyScore("Variable")).toBe(50);
    expect(consistencyScore("Sporadic")).toBe(25);
    expect(consistencyScore("Insufficient Data")).toBe(0);
    expect(consistencyScore(null)).toBe(0);
    expect(consistencyScore("High")).toBe(0);
  });
});

describe("percentiles", () => {
  it("covers the empty, single, low, and high edges", () => {
    expect(percentileRank(5, [])).toBe(100);
    expect(percentileRank(5, [9])).toBe(100);
    expect(percentileRank(1, [1, 2, 3])).toBe(0);
    expect(percentileRank(2, [1, 2, 3])).toBe(50);
    expect(percentileRank(3, [1, 2, 3])).toBe(100);
    expect(percentileRank(0, [1, 2, 3])).toBe(0);
    expect(percentileRank(9, [1, 2, 3])).toBe(100);
    expect(percentileRank(2, [1, 2, 3, 4])).toBe(33.33);
  });

  it("gives tied values the same rank", () => {
    expect(percentileRank(5, [1, 5, 5, 9])).toBe(66.67);
    expect(percentileRank(5, [1, 5, 5, 9])).toBe(percentileRank(5, [1, 5, 5, 9]));
  });
});

describe("VIP cut", () => {
  const scores = [10, 10, 10, 10, 10, 10, 10, 10, 50, 50, 100];

  it("requires 10 ranked customers", () => {
    expect(VIP_MIN_CUSTOMERS).toBe(10);
    expect(VIP_PERCENTILE).toBe(90);
    const nine = repeat(9, 100);
    expect(isVip(100, { spend: nine, orders: nine, scores: nine })).toBe(false);
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(isVip(10, { spend: ten, orders: ten, scores: ten })).toBe(true);
    expect(isVip(9, { spend: ten, orders: ten, scores: ten })).toBe(false);
  });

  it("treats every customer tied on the 90th percentile as VIP", () => {
    const distribution: ValueDistribution = { spend: scores, orders: scores, scores };
    expect(percentileRank(50, scores)).toBe(90);
    expect(percentileRank(10, scores)).toBe(70);
    expect(isVip(50, distribution)).toBe(true);
    expect(isVip(10, distribution)).toBe(false);
    expect(isVip(100, distribution)).toBe(true);
  });

  it("labels spend and frequency leaders without the Emerging VIP gates", () => {
    const quiet = { score: 10, orderFrequencyTrend: "Stable", customerStatus: "Lapsed" };
    expect(vipClassification({ vip: false, spendPercentile: 99, frequencyPercentile: 99, ...quiet })).toBe("Not VIP");
    expect(vipClassification({ vip: true, spendPercentile: 90, frequencyPercentile: 90, ...quiet })).toBe(
      "High Value & High Frequency",
    );
    expect(vipClassification({ vip: true, spendPercentile: 90, frequencyPercentile: 89.99, ...quiet })).toBe(
      "Spend Leader",
    );
    expect(vipClassification({ vip: true, spendPercentile: 89.99, frequencyPercentile: 95, ...quiet })).toBe(
      "Frequency Leader",
    );
  });

  it("requires a value score of at least 65 for Emerging VIP", () => {
    expect(EMERGING_VIP_MIN_SCORE).toBe(65);
    const emerging = emergingVip();
    expect(vipClassification({ ...emerging, score: 65 })).toBe("Emerging VIP");
    expect(vipClassification({ ...emerging, score: 64.99 })).toBe("Not VIP");
  });

  it("requires an Increasing order-frequency trend for Emerging VIP", () => {
    const emerging = emergingVip();
    expect(vipClassification({ ...emerging, orderFrequencyTrend: "Increasing" })).toBe("Emerging VIP");
    expect(vipClassification({ ...emerging, orderFrequencyTrend: "Stable" })).toBe("Not VIP");
    expect(vipClassification({ ...emerging, orderFrequencyTrend: "Decreasing" })).toBe("Not VIP");
    expect(vipClassification({ ...emerging, orderFrequencyTrend: "Insufficient Data" })).toBe("Not VIP");
  });

  it("requires customer status Active or New for Emerging VIP", () => {
    const emerging = emergingVip();
    expect(vipClassification({ ...emerging, customerStatus: "Active" })).toBe("Emerging VIP");
    expect(vipClassification({ ...emerging, customerStatus: "New" })).toBe("Emerging VIP");
    expect(vipClassification({ ...emerging, customerStatus: "At Risk" })).toBe("Not VIP");
    expect(vipClassification({ ...emerging, customerStatus: "Lapsed" })).toBe("Not VIP");
    expect(vipClassification({ ...emerging, customerStatus: "Lost" })).toBe("Not VIP");
  });
});

function emergingVip(): {
  vip: boolean;
  spendPercentile: number;
  frequencyPercentile: number;
  score: number;
  orderFrequencyTrend: string;
  customerStatus: string;
} {
  return {
    vip: true,
    spendPercentile: 70,
    frequencyPercentile: 70,
    score: 80,
    orderFrequencyTrend: "Increasing",
    customerStatus: "Active",
  };
}

describe("value fields from a stored distribution", () => {
  it("returns null when the distribution is missing and blanks a contact with no orders", () => {
    const metrics = computeM06([], "UTC", NOW);
    expect(valueFieldValues(metrics, null)).toBeNull();
    expect(valueFieldValues(metrics, { spend: [10], orders: [1], scores: [10] })).toEqual({
      lifetime_spend_percentile: "",
      order_frequency_percentile: "",
      customer_value_score: "",
      vip_classification: "",
      vip_status: "",
    });
  });

  it("ranks one contact against the previous distribution, including the 10-customer gate", () => {
    const metrics = computeM06(
      [order({ amount: 100, createdAt: "2026-01-10T00:00:00.000Z", deliveryMethod: "shipping" })],
      "UTC",
      NOW,
    );
    expect(metrics.daysSinceLastOrder).toBe(1);
    expect(metrics.purchaseConsistency).toBe("Insufficient Data");
    const nine = {
      spend: repeat(9, 1),
      orders: repeat(9, 10),
      scores: repeat(9, 0),
    };
    const below = valueFieldValues(metrics, nine);
    expect(below?.lifetime_spend_percentile).toBe("100.00");
    expect(below?.order_frequency_percentile).toBe("0.00");
    expect(below?.customer_value_score).toBe("60.00");
    expect(below?.vip_status).toBe("Not VIP");
    expect(below?.vip_classification).toBe("Not VIP");

    const ten = {
      spend: repeat(10, 1),
      orders: repeat(10, 10),
      scores: repeat(10, 0),
    };
    const vip = valueFieldValues(metrics, ten);
    expect(vip).toMatchObject({
      lifetime_spend_percentile: "100.00",
      order_frequency_percentile: "0.00",
      customer_value_score: "60.00",
      vip_classification: "Spend Leader",
      vip_status: "VIP",
    });
  });

  it("writes Emerging VIP when the score, order-frequency trend, and status all pass", () => {
    const metrics = computeM06(
      [
        order({ id: "o1", amount: 40, createdAt: "2025-12-01T12:00:00.000Z" }),
        order({ id: "o2", amount: 40, createdAt: "2025-12-21T12:00:00.000Z" }),
        order({ id: "o3", amount: 40, createdAt: "2026-01-10T12:00:00.000Z" }),
      ],
      "UTC",
      NOW,
    );
    expect(metrics.customerStatus).toBe("Active");
    expect(metrics.orderFrequencyTrend).toBe("Increasing");
    expect(metrics.purchaseConsistency).toBe("Highly Consistent");
    const distribution = {
      spend: [10, 10, 10, 10, 20, 20, 50, 120, 500, 900],
      orders: [1, 1, 1, 2, 2, 3, 8, 8, 8, 8],
      scores: repeat(10, 0),
    };
    const fields = valueFieldValues(metrics, distribution);
    expect(fields).toMatchObject({
      lifetime_spend_percentile: "77.78",
      order_frequency_percentile: "55.56",
      customer_value_score: "80.00",
      vip_classification: "Emerging VIP",
      vip_status: "VIP",
    });
  });

  it("stores scores for each location's own samples and no contact ids", () => {
    const first = buildValueDistribution([
      { spend: 10, orders: 1, recency: 100, consistency: 0 },
      { spend: 30, orders: 4, recency: 75, consistency: 100 },
    ]);
    const second = buildValueDistribution([{ spend: 500, orders: 2, recency: 0, consistency: 25 }]);
    expect(first.spend).toEqual([10, 30]);
    expect(second.spend).toEqual([500]);
    expect(first.scores).toHaveLength(2);
    expect(second.scores).not.toEqual(first.scores);
    const raw = JSON.parse(serializeValueDistribution(first)) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["orders", "scores", "spend", "v"]);
    expect(JSON.stringify(raw)).not.toContain("contact");
  });
});
