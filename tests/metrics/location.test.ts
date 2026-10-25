import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyLatestOrderDetail } from "../../src/ghl/latest-order-detail.js";
import { parseOrderResource } from "../../src/ghl/parse.js";
import type { GhlOrder } from "../../src/ghl/types.js";
import { computeM06, resolveLastOrderLocation } from "../../src/metrics/index.js";
import { M06_WRITTEN_KEYS } from "../../src/schema/fields.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { metricsHash } from "../../src/writeback/hash.js";
import { order } from "../helpers/orders.js";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const BRANCH_KEYS = ["location", "locationName", "store", "storeName", "branch", "branchName"] as const;

function shippingFixture(): GhlOrder {
  const body = JSON.parse(readFileSync(new URL("../../fixtures/order-detail-shipping.json", import.meta.url), "utf8")) as unknown;
  const parsed = parseOrderResource(body);
  if (!parsed) throw new Error("order-detail-shipping.json");
  return parsed;
}

describe("last order location", () => {
  it("uses each delivery branch field, as a string or an object name, ahead of the source name", () => {
    for (const key of BRANCH_KEYS) {
      expect(resolveLastOrderLocation({ delivery: { [key]: `${key} branch` }, sourceName: "STENZ STORE" })).toBe(
        `${key} branch`,
      );
      expect(
        resolveLastOrderLocation({ delivery: { [key]: { name: `  ${key} object  ` } }, sourceName: "STENZ STORE" }),
      ).toBe(`${key} object`);
    }
  });

  it("prefers an earlier delivery field over a later one and over the order", () => {
    expect(
      resolveLastOrderLocation({
        delivery: { location: "Nasr City", branchName: "Later" },
        store: "Order level",
        sourceName: "STENZ STORE",
      }),
    ).toBe("Nasr City");
  });

  it("skips empty, whitespace, and nameless values and keeps the next branch field", () => {
    expect(
      resolveLastOrderLocation({
        delivery: {
          location: "",
          locationName: "   ",
          store: { name: " " },
          storeName: { id: "no-name" },
          branch: 4,
          branchName: "Kept",
        },
        sourceName: "STENZ STORE",
      }),
    ).toBe("Kept");
    expect(
      resolveLastOrderLocation({
        delivery: { location: null, locationName: { name: "" } },
        branch: { name: "From order" },
        sourceName: "STENZ STORE",
      }),
    ).toBe("From order");
  });

  it("uses the same names on the order when delivery has no branch", () => {
    for (const key of BRANCH_KEYS) {
      expect(
        resolveLastOrderLocation({
          delivery: { method: "shipping" },
          [key]: `${key} order`,
          source: { name: "Nested source" },
          sourceName: "STENZ STORE",
        }),
      ).toBe(`${key} order`);
      expect(resolveLastOrderLocation({ [key]: { name: `${key} object` }, sourceName: "STENZ STORE" })).toBe(
        `${key} object`,
      );
    }
  });

  it("falls back to the source name, then writes nothing when no name is available", () => {
    expect(resolveLastOrderLocation({ delivery: { method: "shipping" }, source: { name: "  STENZ STORE  " } })).toBe(
      "STENZ STORE",
    );
    expect(resolveLastOrderLocation({ source: { name: { name: "  Nested  " } } })).toBe("Nested");
    expect(resolveLastOrderLocation({ source: { name: { name: "Nested" } }, sourceName: "STENZ STORE" })).toBe(
      "STENZ STORE",
    );
    expect(resolveLastOrderLocation({ sourceName: "STENZ STORE" })).toBe("STENZ STORE");
    expect(resolveLastOrderLocation({ sourceName: " STENZ STORE " })).toBe(" STENZ STORE ");
    expect(resolveLastOrderLocation({ source: "website", sourceSubType: "store" })).toBeNull();
    expect(resolveLastOrderLocation({ delivery: { method: "pickup" }, source: { type: "website" }, sourceName: "" })).toBe(
      null,
    );
    expect(resolveLastOrderLocation(null)).toBeNull();
    expect(resolveLastOrderLocation({})).toBeNull();

    const metrics = computeM06(
      [order({ sourceName: null, branchName: null, createdAt: "2026-10-21T12:00:00.000Z" })],
      "UTC",
      NOW,
    );
    expect(metrics.lastOrderLocation).toBeNull();
    expect(formatM06Values(metrics).last_order_location).toBe("");
    expect(M06_WRITTEN_KEYS).toContain("last_order_location");
  });

  it("reads the branch from the parsed order detail and leaves the Test Lab shipping detail on the source name", async () => {
    const shipping = shippingFixture();
    expect(shipping.branchName).toBeNull();
    expect(shipping.deliveryMethod).toBe("shipping");
    expect(shipping.sourceName).toBeNull();

    const listed = order({
      id: "order_detail_shipping",
      sourceName: "STENZ STORE",
      branchName: null,
      deliveryMethod: "shipping",
      createdAt: "2026-10-21T18:47:57.185Z",
      amount: 40,
      sourceSubType: "store",
    });
    const unchanged = await applyLatestOrderDetail([listed], async () => shipping);
    const stayed = formatM06Values(computeM06(unchanged, "Africa/Cairo", NOW));
    const before = formatM06Values(computeM06([listed], "Africa/Cairo", NOW));
    expect(stayed.last_order_location).toBe("STENZ STORE");
    expect(metricsHash(stayed)).toBe(metricsHash(before));

    const branched = parseOrderResource({
      order: {
        id: "order_detail_shipping",
        delivery: { method: "shipping", branch: { name: "  Maadi  " } },
        sourceName: "STENZ STORE",
      },
    });
    expect(branched?.branchName).toBe("Maadi");
    const moved = await applyLatestOrderDetail([listed], async () => branched);
    const withBranch = formatM06Values(computeM06(moved, "Africa/Cairo", NOW));
    expect(withBranch.last_order_location).toBe("Maadi");
    const { last_order_location: branchLocation, ...branchRest } = withBranch;
    const { last_order_location: sourceLocation, ...sourceRest } = stayed;
    expect(branchLocation).toBe("Maadi");
    expect(sourceLocation).toBe("STENZ STORE");
    expect(branchRest).toEqual(sourceRest);
    expect(metricsHash(withBranch)).not.toBe(metricsHash(stayed));
  });

  it("parses source.name only when the flat source name is absent", () => {
    const nested = parseOrderResource({
      order: { id: "nested", source: { name: " STENZ STORE ", type: "website" }, delivery: { method: "shipping" } },
    });
    expect(nested).toMatchObject({ sourceName: "STENZ STORE", branchName: null, deliveryMethod: "shipping" });

    const flat = parseOrderResource({
      order: { id: "flat", sourceName: " STENZ STORE ", source: { name: "Other" } },
    });
    expect(flat?.sourceName).toBe(" STENZ STORE ");
    expect(flat?.branchName).toBeNull();

    const blank = parseOrderResource({
      order: { id: "blank", delivery: { location: "   ", method: "shipping" }, sourceName: "STENZ STORE" },
    });
    expect(blank?.branchName).toBeNull();
    expect(blank?.sourceName).toBe("STENZ STORE");

    const orderLevel = parseOrderResource({ order: { id: "order-level", storeName: { name: "Zamalek" } } });
    expect(orderLevel?.branchName).toBe("Zamalek");
  });

  it("takes the branch from the latest qualifying order only", async () => {
    const older = order({
      id: "older",
      createdAt: "2026-10-20T12:00:00.000Z",
      branchName: "Old Branch",
      sourceName: "OLD SOURCE",
      deliveryMethod: "pickup",
    });
    const latest = order({
      id: "latest",
      createdAt: "2026-10-22T12:00:00.000Z",
      branchName: null,
      sourceName: "STENZ STORE",
      deliveryMethod: null,
    });
    expect(computeM06([older, latest], "UTC", NOW).lastOrderLocation).toBe("STENZ STORE");

    const cancelled = order({
      id: "cancelled",
      status: "cancelled",
      createdAt: "2026-10-23T12:00:00.000Z",
      branchName: "Cancelled Branch",
      sourceName: "CANCELLED",
    });
    expect(computeM06([older, cancelled], "UTC", NOW).lastOrderLocation).toBe("Old Branch");

    const listedTest = order({
      id: "tested",
      createdAt: "2026-10-23T12:00:00.000Z",
      markAsTest: false,
      branchName: "Test Branch",
      sourceName: "TEST SOURCE",
      deliveryMethod: null,
    });
    const testDetail = order({
      id: "tested",
      markAsTest: true,
      branchName: "Test Branch",
      deliveryMethod: "shipping",
    });
    const realDetail = order({
      id: "older",
      branchName: "Heliopolis",
      deliveryMethod: "pickup",
      markAsTest: false,
      sourceName: "STENZ STORE",
    });
    const orders = await applyLatestOrderDetail([listedTest, older], async (orderId) => {
      if (orderId === "tested") return testDetail;
      return realDetail;
    });
    expect(computeM06(orders, "UTC", NOW).lastOrderLocation).toBe("Heliopolis");
    expect(computeM06(orders, "UTC", NOW).qualifyingOrderCount).toBe(1);
  });
});
