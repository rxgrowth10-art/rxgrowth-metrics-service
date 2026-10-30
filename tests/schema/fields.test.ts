import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIELDS,
  M06_HASH_EXCLUDED_KEYS,
  M06_WRITTEN_KEYS,
  M10_WRITTEN_KEYS,
  REMOVED_FIELD_KEYS,
  TEST_LAB_LOCATION_ID,
  WORKFLOW_OWNED_KEYS,
  fieldByKey,
} from "../../src/schema/fields.js";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/test-lab-fields.json", import.meta.url), "utf8")) as Array<{
  id: string;
  fieldKey: string;
  locationId: string;
}>;

describe("generated field contract", () => {
  it("matches the test-lab fixture by field key and id", () => {
    expect(FIELDS).toHaveLength(fixture.length);
    expect(TEST_LAB_LOCATION_ID).toBe("ekxOqjUKW7M6OV9XAVnx");
    for (const field of fixture) {
      expect(field.locationId).toBe(TEST_LAB_LOCATION_ID);
      const key = field.fieldKey.replace(/^contact\./, "");
      expect(fieldByKey(key)?.testLabId).toBe(field.id);
      expect(fieldByKey(key)?.fieldKey).toBe(field.fieldKey);
    }
  });

  it("assigns writers and keeps removed keys out of the catalog", () => {
    expect(fieldByKey("qualifying_order_count")).toMatchObject({
      writer: "m06",
      dataType: "NUMERICAL",
      testLabId: "iU6Dl5xYsdMvAE3NvY4V",
    });
    expect(fieldByKey("lifecycle_stage")).toMatchObject({
      writer: "m06",
      dataType: "TEXT",
      testLabId: "5FKWnukB9jTv4NwOdgTe",
    });
    expect(fieldByKey("metrics_hash")).toMatchObject({
      writer: "m06",
      testLabId: "fPL14V9N1MdHMEVFqr6Q",
    });
    expect(fieldByKey("m06_intelligence_updated_at")).toMatchObject({
      writer: "m06",
      dataType: "DATE",
      testLabId: "xmjTtMO3HzJjoQKN3wqJ",
    });
    expect(fieldByKey("winback_eligibility")?.writer).toBe("m10");
    expect(fieldByKey("winback_tier")?.writer).toBe("m10");
    expect(fieldByKey("winback_cycle_status")?.writer).toBe("workflow");
    expect(fieldByKey("winback_cycle_started_at")?.writer).toBe("workflow");
    for (const key of REMOVED_FIELD_KEYS) {
      expect(fieldByKey(key)).toBeUndefined();
    }
    expect(M06_WRITTEN_KEYS).not.toContain("winback_eligibility");
    expect(M06_WRITTEN_KEYS).not.toContain("winback_tier");
    expect(fieldByKey("last_coupon_code")).toMatchObject({
      writer: "external",
      dataType: "TEXT",
      testLabId: "2VAJ1dipwBArGbM5GUX0",
    });
    expect(fieldByKey("favorite_item")).toMatchObject({
      writer: "m06",
      dataType: "TEXT",
      testLabId: "VIdTmboEkxEgeDGvPVZn",
    });
    expect(fieldByKey("top_items")).toMatchObject({
      writer: "m06",
      dataType: "LARGE_TEXT",
      testLabId: "kXOadhDKENrfuwrIMhnp",
    });
    expect(fieldByKey("preferred_location")).toMatchObject({
      writer: "m06",
      dataType: "TEXT",
      testLabId: "k6MWzkT7MA8ktC8W9x6u",
    });
    expect(fieldByKey("order_source_mix")).toMatchObject({
      writer: "m06",
      dataType: "LARGE_TEXT",
      testLabId: "EAJA4lVVyimYZ4ribDCQ",
    });
    expect(fieldByKey("preferred_order_type")?.picklistOptions).toEqual(["Delivery", "Pickup", "Dine-in"]);
    expect(fieldByKey("primary_order_source")?.picklistOptions).toEqual([
      "Online Store",
      "POS",
      "Delivery Platform",
      "Manual",
      "Imported",
      "Other",
    ]);
    expect(fieldByKey("purchase_consistency")?.picklistOptions).toEqual([
      "Highly Consistent",
      "Consistent",
      "Variable",
      "Sporadic",
      "Insufficient Data",
    ]);
    expect(fieldByKey("favorite_category")).toMatchObject({
      writer: "m06",
      dataType: "TEXT",
      testLabId: "176K49TuVhm0OO23cyvU",
    });
    expect(fieldByKey("top_categories")).toMatchObject({
      writer: "m06",
      dataType: "LARGE_TEXT",
      testLabId: "FMQjJdxag0wDUO6rMFNX",
    });
    expect(fieldByKey("category_diversity")).toMatchObject({
      writer: "m06",
      dataType: "NUMERICAL",
      testLabId: "z2Oh1r3BEouLFOFInXeX",
    });
    expect(M10_WRITTEN_KEYS).toEqual(["winback_eligibility", "winback_tier"]);
    expect(WORKFLOW_OWNED_KEYS).toEqual(["winback_cycle_status", "winback_cycle_started_at"]);
    expect(M06_HASH_EXCLUDED_KEYS).toEqual(["metrics_hash", "m06_intelligence_updated_at"]);
  });

  it("keeps favorite_category as free text with no picklist", () => {
    const field = fieldByKey("favorite_category");
    expect(field).toMatchObject({
      fieldKey: "contact.favorite_category",
      dataType: "TEXT",
      testLabId: "176K49TuVhm0OO23cyvU",
      writer: "m06",
    });
    expect(field?.picklistOptions).toBeUndefined();
  });

  it("pins the current M06 written keys", () => {
    expect([...M06_WRITTEN_KEYS]).toEqual([
      "total_orders",
      "qualifying_order_count",
      "first_order_date",
      "last_order_date",
      "lifetime_value",
      "average_order_value",
      "highest_order_value",
      "lowest_order_value",
      "customer_type",
      "customer_status",
      "lifecycle_stage",
      "last_order_location",
      "last_order_type",
      "average_order_interval_days",
      "typical_order_interval_days",
      "orders_last_30_days",
      "orders_previous_30_days",
      "spend_last_30_days",
      "spend_previous_30_days",
      "order_frequency_trend",
      "spending_trend",
      "days_since_last_order",
      "expected_next_order_date",
      "days_overdue",
      "overdue_ratio",
      "favorite_item",
      "top_items",
      "favorite_category",
      "top_categories",
      "category_diversity",
      "preferred_order_type",
      "preferred_location",
      "purchase_consistency",
      "order_source_mix",
      "primary_order_source",
      "metrics_hash",
      "m06_intelligence_updated_at",
    ]);
  });
});
