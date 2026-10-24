import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryTenantStore, mapTenantRow, type Tenant } from "../../src/tenants";

const tenant: Tenant = {
  locationId: "loc_1",
  name: "Test Lab",
  apiKeyEncrypted: "v1:aa:bb:cc",
  timezone: "Africa/Cairo",
  currency: "EGP",
  m10WorkflowId: "wf_1",
  active: true,
};

describe("memory tenant store", () => {
  it("returns copies and lists only active tenants", async () => {
    const store = new MemoryTenantStore();
    await store.upsert(tenant);
    await store.upsert({ ...tenant, locationId: "loc_2", active: false, name: "Paused" });
    const loaded = await store.getByLocationId("loc_1");
    expect(loaded).toEqual(tenant);
    if (!loaded) throw new Error("missing tenant");
    loaded.name = "mutated";
    expect((await store.getByLocationId("loc_1"))?.name).toBe("Test Lab");
    expect((await store.listActive()).map((item) => item.locationId)).toEqual(["loc_1"]);
  });
});

describe("neon tenant row mapping", () => {
  it("maps a postgres row without treating ciphertext as a loggable secret in the object shape", () => {
    const mapped = mapTenantRow({
      location_id: "loc_1",
      name: "Test Lab",
      api_key_encrypted: "v1:ciphertext",
      timezone: "Africa/Cairo",
      currency: "EGP",
      m10_workflow_id: null,
      active: true,
    });
    expect(mapped).toEqual({
      locationId: "loc_1",
      name: "Test Lab",
      apiKeyEncrypted: "v1:ciphertext",
      timezone: "Africa/Cairo",
      currency: "EGP",
      m10WorkflowId: null,
      active: true,
    });
  });
});

describe("tenant migration", () => {
  it("creates the tenant columns the store reads", () => {
    const sql = readFileSync(new URL("../../migrations/001_tenants.sql", import.meta.url), "utf8");
    for (const column of [
      "location_id",
      "name",
      "api_key_encrypted",
      "timezone",
      "currency",
      "m10_workflow_id",
      "active",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("AES-256-GCM");
  });
});
