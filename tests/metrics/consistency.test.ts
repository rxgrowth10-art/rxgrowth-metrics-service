import { describe, expect, it } from "vitest";
import { computeM06, purchaseConsistencyLabel } from "../../src/metrics/index.js";
import { fieldByKey } from "../../src/schema/fields.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T00:00:00.000Z");

function consistency(dates: readonly string[], timeZone = "UTC"): string {
  const formatted = formatM06Values(
    computeM06(
      dates.map((createdAt, index) => order({ id: `o${index}`, amount: 100, createdAt })),
      timeZone,
      NOW,
    ),
  );
  return formatted.purchase_consistency ?? "";
}

describe("purchase consistency", () => {
  it("labels the population score with the approved cuts", () => {
    expect(purchaseConsistencyLabel([10, 10])).toBe("Highly Consistent");
    expect(purchaseConsistencyLabel([17, 23])).toBe("Highly Consistent");
    expect(purchaseConsistencyLabel([17, 24])).toBe("Consistent");
    expect(purchaseConsistencyLabel([10, 20])).toBe("Consistent");
    expect(purchaseConsistencyLabel([13, 27])).toBe("Consistent");
    expect(purchaseConsistencyLabel([13, 28])).toBe("Variable");
    expect(purchaseConsistencyLabel([10, 30])).toBe("Variable");
    expect(purchaseConsistencyLabel([10, 40])).toBe("Variable");
    expect(purchaseConsistencyLabel([10, 41])).toBe("Sporadic");
    expect(purchaseConsistencyLabel([5, 50])).toBe("Sporadic");
    expect(purchaseConsistencyLabel([10])).toBe("Insufficient Data");
    expect(purchaseConsistencyLabel([])).toBe("Insufficient Data");
    expect(purchaseConsistencyLabel([0, 0, 10])).toBe("Insufficient Data");
    const options = fieldByKey("purchase_consistency")?.picklistOptions ?? [];
    for (const label of ["Highly Consistent", "Consistent", "Variable", "Sporadic", "Insufficient Data"]) {
      expect(options).toContain(label);
    }
  });

  it("uses tenant-timezone day intervals, including same-day orders as one day", () => {
    expect(
      consistency(["2026-09-14T00:00:00.000Z", "2026-09-24T00:00:00.000Z", "2026-10-04T00:00:00.000Z"]),
    ).toBe("Highly Consistent");
    expect(
      consistency(["2026-08-25T00:00:00.000Z", "2026-09-04T00:00:00.000Z", "2026-09-24T00:00:00.000Z"]),
    ).toBe("Consistent");
    expect(
      consistency(["2026-07-01T00:00:00.000Z", "2026-07-11T00:00:00.000Z", "2026-08-10T00:00:00.000Z"]),
    ).toBe("Variable");
    expect(
      consistency(["2026-07-01T00:00:00.000Z", "2026-07-06T00:00:00.000Z", "2026-08-25T00:00:00.000Z"]),
    ).toBe("Sporadic");
    expect(consistency(["2026-10-01T00:00:00.000Z", "2026-10-11T00:00:00.000Z"])).toBe("Insufficient Data");
    expect(
      consistency([
        "2026-06-01T08:00:00.000Z",
        "2026-06-01T18:00:00.000Z",
        "2026-06-02T12:00:00.000Z",
      ]),
    ).toBe("Insufficient Data");
    expect(
      consistency(
        ["2026-01-01T22:30:00.000Z", "2026-01-02T20:30:00.000Z", "2026-01-03T00:00:00.000Z"],
        "Africa/Cairo",
      ),
    ).toBe("Insufficient Data");
  });

  it("ignores orders that do not qualify", () => {
    const formatted = formatM06Values(
      computeM06(
        [
          order({ amount: 100, createdAt: "2026-09-14T00:00:00.000Z" }),
          order({ amount: 100, status: "cancelled", createdAt: "2026-09-15T00:00:00.000Z" }),
          order({ amount: 100, paymentStatus: "refunded", createdAt: "2026-09-24T00:00:00.000Z" }),
          order({ amount: 100, createdAt: "2026-10-04T00:00:00.000Z" }),
        ],
        "UTC",
        NOW,
      ),
    );
    expect(formatted.qualifying_order_count).toBe("2");
    expect(formatted.purchase_consistency).toBe("Insufficient Data");
  });
});
