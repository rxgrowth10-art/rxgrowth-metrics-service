import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultDeps } from "../../src/runtime/deps";
import { createEnvTenantStore, decryptApiKey, encryptApiKey, parseEncryptionKey } from "../../src/tenants";

const KEY = parseEncryptionKey(Buffer.alloc(32, 9).toString("base64"));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env tenant store", () => {
  it("loads one tenant from TENANT_CONFIG and encrypts a plaintext api key", async () => {
    const store = createEnvTenantStore(KEY, {
      TENANT_CONFIG: JSON.stringify({
        locationId: "loc_env",
        name: "Env Lab",
        apiKey: "pit-env",
        timezone: "Africa/Cairo",
        currency: "EGP",
        m10WorkflowId: "wf_env",
        active: true,
      }),
    });
    const tenant = await store.getByLocationId("loc_env");
    expect(tenant?.name).toBe("Env Lab");
    expect(tenant?.timezone).toBe("Africa/Cairo");
    expect(tenant?.m10WorkflowId).toBe("wf_env");
    expect(decryptApiKey(tenant?.apiKeyEncrypted ?? "", KEY)).toBe("pit-env");
    expect(await store.getByLocationId("other")).toBeNull();
    expect((await store.listActive()).map((item) => item.locationId)).toEqual(["loc_env"]);
  });

  it("loads discrete env vars and keeps an already encrypted key", async () => {
    const ciphertext = encryptApiKey("pit-discrete", KEY);
    const store = createEnvTenantStore(KEY, {
      TENANT_LOCATION_ID: "loc_discrete",
      TENANT_NAME: "Discrete",
      TENANT_API_KEY_ENCRYPTED: ciphertext,
      TENANT_TIMEZONE: "America/New_York",
      TENANT_CURRENCY: "USD",
      TENANT_ACTIVE: "false",
    });
    const tenant = await store.getByLocationId("loc_discrete");
    expect(tenant?.active).toBe(false);
    expect(tenant?.apiKeyEncrypted).toBe(ciphertext);
    expect(await store.listActive()).toEqual([]);
    await store.upsert({ ...tenant!, active: true });
    expect((await store.listActive()).map((item) => item.locationId)).toEqual(["loc_discrete"]);
  });

  it("rejects a config that does not name exactly one key", () => {
    expect(() => createEnvTenantStore(KEY, { TENANT_LOCATION_ID: "loc" })).toThrow(/apiKey/);
    expect(() =>
      createEnvTenantStore(KEY, {
        TENANT_CONFIG: JSON.stringify({ locationId: "loc", apiKey: "a", apiKeyEncrypted: "v1:x:y:z" }),
      }),
    ).toThrow(/only one/);
    expect(() => createEnvTenantStore(KEY, {})).toThrow(/TENANT_LOCATION_ID/);
    expect(() => createEnvTenantStore(KEY, { TENANT_CONFIG: "{" })).toThrow(/JSON/);
  });
});

describe("TENANT_STORE selection", () => {
  it("uses the env store without DATABASE_URL and keeps Neon as the default", async () => {
    vi.stubEnv("TENANT_STORE", "env");
    vi.stubEnv("TENANT_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv(
      "TENANT_CONFIG",
      JSON.stringify({ locationId: "loc_env", name: "Env Lab", apiKey: "pit-env", timezone: "UTC" }),
    );
    const deps = createDefaultDeps();
    const tenant = await deps.tenants.getByLocationId("loc_env");
    expect(tenant?.currency).toBe("USD");
    expect(decryptApiKey(tenant?.apiKeyEncrypted ?? "", deps.encryptionKey)).toBe("pit-env");

    vi.stubEnv("TENANT_STORE", "");
    expect(() => createDefaultDeps()).toThrow(/DATABASE_URL/);
    vi.stubEnv("TENANT_STORE", "sqlite");
    vi.stubEnv("DATABASE_URL", "postgres://example");
    expect(() => createDefaultDeps()).toThrow(/TENANT_STORE/);
  });
});
