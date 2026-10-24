import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../api/webhooks/ghl";
import type { GhlClient } from "../../src/ghl";
import { MemoryIdempotencyStore } from "../../src/idempotency";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields";
import { encryptApiKey, MemoryTenantStore, parseEncryptionKey, type Tenant } from "../../src/tenants";
import type { WebhookDeps } from "../../src/webhook/handle";
import { handleGhlWebhook } from "../../src/webhook/handle";
import { order } from "../helpers/orders";

const KEY = parseEncryptionKey(Buffer.alloc(32, 4).toString("base64"));
const NOW = new Date("2026-01-21T12:00:00.000Z");

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    locationId: "loc_1",
    name: "Test Lab",
    apiKeyEncrypted: encryptApiKey("pit-plaintext", KEY),
    timezone: "UTC",
    currency: "EGP",
    m10WorkflowId: null,
    active: true,
    ...overrides,
  };
}

function deps(options?: {
  orders?: ReturnType<typeof order>[];
  active?: boolean;
  secret?: string | null;
  fail?: boolean;
}) {
  const tenants = new MemoryTenantStore();
  const seenKeys: string[] = [];
  let listCalls = 0;
  const updates: Array<Record<string, string>> = [];
  const ghl: GhlClient = {
    async listOrders() {
      listCalls += 1;
      if (options?.fail) throw new Error("upstream down");
      return options?.orders ?? [order({ amount: 15, createdAt: "2026-01-11T00:00:00.000Z" })];
    },
    async getContact() {
      return { id: "contact_1", customFields: [] };
    },
    async listCustomFields() {
      return M06_WRITTEN_KEYS.map((key) => {
        const field = fieldByKey(key);
        if (!field) throw new Error(key);
        return { id: field.testLabId, fieldKey: field.fieldKey, name: field.name, dataType: field.dataType };
      });
    },
    async updateContact(_id, fields) {
      updates.push(Object.fromEntries(fields.map((field) => [field.key, field.value])));
    },
    async searchContacts() {
      return [];
    },
    async addContactToWorkflow() {
      return undefined;
    },
  };
  const webhookDeps: WebhookDeps = {
    tenants,
    idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
    encryptionKey: KEY,
    webhookSecret: options?.secret ?? null,
    ghlFactory: ({ apiKey, locationId }) => {
      seenKeys.push(`${locationId}:${apiKey}`);
      return ghl;
    },
    now: () => NOW,
  };
  return {
    deps: webhookDeps,
    tenants,
    seenKeys,
    updates,
    listCalls: () => listCalls,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/webhooks/ghl", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("GHL webhook", () => {
  it("processes a duplicate nudge once and ignores payload values", async () => {
    const harness = deps({
      orders: [order({ amount: 15, createdAt: "2026-01-11T00:00:00.000Z", sourceSubType: "Pickup" })],
    });
    await harness.tenants.upsert(tenant());
    const payload = {
      locationId: "loc_1",
      contactId: "contact_1",
      amount: 999999,
      orders: [{ amount: 1, paymentStatus: "paid", liveMode: true }],
      lifetimeValue: 1,
    };
    const first = await handleGhlWebhook(post(payload), harness.deps);
    const second = await handleGhlWebhook(post(payload), harness.deps);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: true, written: true });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ accepted: true, duplicate: true });
    expect(harness.listCalls()).toBe(1);
    expect(harness.seenKeys).toEqual(["loc_1:pit-plaintext"]);
    expect(Object.keys(harness.updates[0] ?? {})).toEqual([...M06_WRITTEN_KEYS]);
    expect(harness.updates[0]?.lifetime_value).toBe("15.00");
    expect(harness.updates[0]?.total_orders).toBe("1");
    expect(harness.updates[0]?.winback_eligibility).toBeUndefined();
  });

  it("accepts an unknown or inactive tenant without calling GoHighLevel", async () => {
    const harness = deps();
    const unknown = await handleGhlWebhook(
      post({ locationId: "missing", contactId: "contact_1" }),
      harness.deps,
    );
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toMatchObject({ accepted: false, reason: "unknown_tenant" });
    await harness.tenants.upsert(tenant({ active: false }));
    const inactive = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "contact_1" }),
      harness.deps,
    );
    expect(await inactive.json()).toMatchObject({ accepted: false, reason: "inactive_tenant" });
    expect(harness.listCalls()).toBe(0);
    expect(harness.seenKeys).toEqual([]);
  });

  it("requires the shared secret only when one is configured", async () => {
    const open = deps();
    await open.tenants.upsert(tenant());
    expect((await handleGhlWebhook(post({ locationId: "loc_1", contactId: "c" }), open.deps)).status).toBe(202);

    const closed = deps({ secret: "hook-secret" });
    await closed.tenants.upsert(tenant());
    const rejected = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "c" }), closed.deps);
    expect(rejected.status).toBe(401);
    const accepted = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "c" }, { "x-webhook-secret": "hook-secret" }),
      closed.deps,
    );
    expect(accepted.status).toBe(202);
  });

  it("releases the dedupe key when processing fails so a retry can run", async () => {
    const harness = deps({ fail: true });
    await harness.tenants.upsert(tenant());
    const failed = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "c", eventId: "evt-1" }), harness.deps);
    expect(failed.status).toBe(500);
    const again = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "c", eventId: "evt-1" }), harness.deps);
    expect(again.status).toBe(500);
    expect(harness.listCalls()).toBe(2);
  });

  it("rejects a locked contact without consuming the event", async () => {
    const harness = deps();
    await harness.tenants.upsert(tenant());
    await harness.deps.idempotency.setNx("lock:loc_1:contact_1", 30);
    const locked = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "contact_1", eventId: "evt-9" }),
      harness.deps,
    );
    expect(locked.status).toBe(503);
    await harness.deps.idempotency.del("lock:loc_1:contact_1");
    const retried = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "contact_1", eventId: "evt-9" }),
      harness.deps,
    );
    expect(retried.status).toBe(202);
    expect(harness.listCalls()).toBe(1);
  });

  it("returns 400 for a body that is not a location and contact nudge", async () => {
    const harness = deps();
    expect((await handleGhlWebhook(post({ locationId: "loc_1" }), harness.deps)).status).toBe(400);
    const request = new Request("https://example.test/api/webhooks/ghl", { method: "POST", body: "{" });
    expect((await handleGhlWebhook(request, harness.deps)).status).toBe(400);
    expect((await handleGhlWebhook(new Request("https://example.test/api/webhooks/ghl"), harness.deps)).status).toBe(405);
  });
});

describe("POST /api/webhooks/ghl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports misconfiguration instead of calling GoHighLevel", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TENANT_ENCRYPTION_KEY", "");
    const response = await POST(post({ locationId: "loc_1", contactId: "c" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "misconfigured" });
  });
});
