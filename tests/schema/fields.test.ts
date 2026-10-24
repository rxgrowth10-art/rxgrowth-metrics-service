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
    expect(M10_WRITTEN_KEYS).toEqual(["winback_eligibility", "winback_tier"]);
    expect(WORKFLOW_OWNED_KEYS).toEqual(["winback_cycle_status", "winback_cycle_started_at"]);
    expect(M06_HASH_EXCLUDED_KEYS).toEqual(["metrics_hash", "m06_intelligence_updated_at"]);
  });
});
