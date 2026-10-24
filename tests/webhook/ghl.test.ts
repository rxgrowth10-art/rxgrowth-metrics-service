import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "../../api/webhooks/ghl.js";
import type { GhlClient } from "../../src/ghl/index.js";
import { MemoryIdempotencyStore } from "../../src/idempotency/index.js";
import { M06_WRITTEN_KEYS, fieldByKey } from "../../src/schema/fields.js";
import { hashWebhookToken } from "../../src/http/webhook-token.js";
import { encryptApiKey, MemoryTenantStore, parseEncryptionKey, type Tenant } from "../../src/tenants/index.js";
import type { WebhookDeps } from "../../src/webhook/handle.js";
import { handleGhlWebhook } from "../../src/webhook/handle.js";
import { order } from "../helpers/orders.js";

const KEY = parseEncryptionKey(Buffer.alloc(32, 4).toString("base64"));
const NOW = new Date("2026-01-21T12:00:00.000Z");
const WEBHOOK_TOKEN = "tenant-webhook-token";
const WEBHOOK_HASH = hashWebhookToken(WEBHOOK_TOKEN);

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    locationId: "loc_1",
    name: "Test Lab",
    apiKeyEncrypted: encryptApiKey("pit-plaintext", KEY),
    timezone: "UTC",
    currency: "EGP",
    m10WorkflowId: null,
    webhookTokenHash: WEBHOOK_HASH,
    active: true,
    ...overrides,
  };
}

function deps(options?: {
  orders?: ReturnType<typeof order>[];
  ordersAt?: (call: number) => ReturnType<typeof order>[];
  active?: boolean;
  fail?: boolean;
  detail?: ReturnType<typeof order> | null;
  detailError?: Error;
  onFirstList?: () => Promise<void> | void;
}) {
  const tenants = new MemoryTenantStore();
  const seenKeys: string[] = [];
  let listCalls = 0;
  let detailCalls = 0;
  const updates: Array<Record<string, string>> = [];
  let storedHash: string | null = null;
  const hashId = fieldByKey("metrics_hash")?.testLabId ?? "hash";
  const ghl: GhlClient = {
    async listOrders() {
      listCalls += 1;
      if (options?.onFirstList && listCalls === 1) await options.onFirstList();
      if (options?.fail) throw new Error("upstream down");
      if (options?.ordersAt) return options.ordersAt(listCalls);
      return options?.orders ?? [order({ amount: 15, createdAt: "2026-01-11T00:00:00.000Z" })];
    },
    async getOrder() {
      detailCalls += 1;
      if (options?.detailError) throw options.detailError;
      return options?.detail === undefined ? null : options.detail;
    },
    async getContact() {
      return {
        id: "contact_1",
        customFields: storedHash ? [{ id: hashId, key: "metrics_hash", value: storedHash }] : [],
      };
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
      storedHash = fields.find((field) => field.key === "metrics_hash")?.value ?? storedHash;
    },
    async searchContacts() {
      return [];
    },
    async searchContactsPage() {
      return { contacts: [], searchAfter: null };
    },
    async addContactToWorkflow() {
      return undefined;
    },
  };
  const webhookDeps: WebhookDeps = {
    tenants,
    idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
    encryptionKey: KEY,
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
    detailCalls: () => detailCalls,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return postUrl(body, `https://example.test/api/webhooks/ghl?t=${WEBHOOK_TOKEN}`, headers);
}

function postUrl(body: unknown, url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("GHL webhook", () => {
  it("recomputes a later nudge for the same contact and ignores payload values", async () => {
    const harness = deps({
      orders: [order({ id: "order_nudge", amount: 15, createdAt: "2026-01-11T00:00:00.000Z", sourceSubType: "store" })],
      detail: order({ id: "order_nudge", deliveryMethod: "shipping", markAsTest: false }),
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
    expect(await second.json()).toEqual({ accepted: true, written: false });
    expect(harness.listCalls()).toBe(2);
    expect(harness.seenKeys).toEqual(["loc_1:pit-plaintext", "loc_1:pit-plaintext"]);
    expect(Object.keys(harness.updates[0] ?? {})).toEqual([...M06_WRITTEN_KEYS]);
    expect(harness.updates[0]?.lifetime_value).toBe("15.00");
    expect(harness.updates[0]?.total_orders).toBe("1");
    expect(harness.updates[0]?.last_order_type).toBe("Delivery");
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

  it("rejects a missing webhook hash in every environment, including preview", async () => {
    const open = deps();
    await open.tenants.upsert(tenant({ webhookTokenHash: null }));
    const missing = await handleGhlWebhook(
      postUrl({ locationId: "loc_1", contactId: "c" }, "https://example.test/api/webhooks/ghl"),
      open.deps,
    );
    expect(missing.status).toBe(401);
    expect(JSON.stringify(await missing.json())).not.toContain(WEBHOOK_TOKEN);

    const closed = deps();
    await closed.tenants.upsert(tenant());
    const rejected = await handleGhlWebhook(
      postUrl({ locationId: "loc_1", contactId: "c" }, "https://example.test/api/webhooks/ghl?t=wrong"),
      closed.deps,
    );
    expect(rejected.status).toBe(401);
    const accepted = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "c" }), closed.deps);
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

  it("runs a second nudge ten seconds later when a new order exists", async () => {
    let now = NOW.getTime();
    const firstOrders = [order({ id: "o1", amount: 10, createdAt: "2026-01-01T12:00:00.000Z" })];
    const laterOrders = [
      ...firstOrders,
      order({ id: "o2", amount: 25, createdAt: "2026-01-11T12:00:00.000Z" }),
    ];
    const harness = deps({ ordersAt: (call) => (call === 1 ? firstOrders : laterOrders) });
    harness.deps.idempotency = new MemoryIdempotencyStore(() => now);
    await harness.tenants.upsert(tenant());
    const first = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), harness.deps);
    expect(await first.json()).toMatchObject({ accepted: true, written: true });
    now += 10_000;
    const second = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), harness.deps);
    expect(await second.json()).toEqual({ accepted: true, written: true });
    expect(harness.listCalls()).toBe(2);
    expect(harness.updates.at(-1)?.total_orders).toBe("2");
    expect(harness.updates.at(-1)?.lifetime_value).toBe("35.00");
  });

  it("does not drop a nudge that arrives while the contact lock is held", async () => {
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const harness = deps({
      onFirstList: () => {
        markEntered();
        return gate;
      },
      ordersAt: (call) =>
        call === 1
          ? [order({ id: "o1", amount: 10, createdAt: "2026-01-01T12:00:00.000Z" })]
          : [
              order({ id: "o1", amount: 10, createdAt: "2026-01-01T12:00:00.000Z" }),
              order({ id: "o2", amount: 20, createdAt: "2026-01-11T12:00:00.000Z" }),
            ],
    });
    await harness.tenants.upsert(tenant());
    const firstPromise = handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), harness.deps);
    await entered;
    const second = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), harness.deps);
    expect(await second.json()).toEqual({ accepted: true, queued: true });
    releaseFirst();
    const first = await firstPromise;
    expect(await first.json()).toMatchObject({ accepted: true, written: true });
    expect(harness.listCalls()).toBeGreaterThanOrEqual(2);
    expect(harness.updates.at(-1)?.total_orders).toBe("2");
  });

  it("fetches list detail only when paymentStatus or liveMode is missing, then the latest order once", async () => {
    const listed = order({
      id: "order_sample_1",
      amount: 93.5,
      paymentStatus: null,
      liveMode: null,
      markAsTest: null,
      sourceSubType: "store",
      createdAt: "2026-10-21T18:47:57.185Z",
    });
    const detail = order({
      ...listed,
      paymentStatus: "unpaid",
      liveMode: true,
      markAsTest: null,
    });
    const harness = deps({ orders: [listed], detail });
    await harness.tenants.upsert(tenant());
    const response = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), harness.deps);
    expect(response.status).toBe(202);
    expect(harness.detailCalls()).toBe(2);
    expect(harness.updates[0]?.total_orders).toBe("1");
    expect(harness.updates[0]?.lifetime_value).toBe("93.50");
    expect(harness.updates[0]?.last_order_type).toBeUndefined();

    const complete = deps({
      orders: [order({ ...listed, paymentStatus: "unpaid", liveMode: true })],
    });
    await complete.tenants.upsert(tenant());
    await handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), complete.deps);
    expect(complete.detailCalls()).toBe(1);
  });

  it("still accepts the nudge when the latest order detail returns 5xx", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const harness = deps({
        orders: [order({ id: "order_down", amount: 15, createdAt: "2026-01-11T00:00:00.000Z", sourceSubType: "store" })],
        detailError: new Error('status 500 {"contactSnapshot":{"email":"secret@example.test"}}'),
      });
      await harness.tenants.upsert(tenant());
      const response = await handleGhlWebhook(post({ locationId: "loc_1", contactId: "contact_1" }), harness.deps);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ accepted: true, written: true });
      expect(harness.updates[0]?.total_orders).toBe("1");
      expect(harness.updates[0]?.last_order_type).toBeUndefined();
      const text = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).not.toContain("contactSnapshot");
      expect(text).not.toContain("secret@example.test");
    } finally {
      warn.mockRestore();
    }
  });

  it("queues while a lock is held and still dedupes an explicit event id", async () => {
    const harness = deps();
    await harness.tenants.upsert(tenant());
    await harness.deps.idempotency.setNx("lock:loc_1:contact_1", 30);
    const locked = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "contact_1", eventId: "evt-9" }),
      harness.deps,
    );
    expect(await locked.json()).toEqual({ accepted: true, queued: true });
    expect(harness.listCalls()).toBe(0);
    await harness.deps.idempotency.del("lock:loc_1:contact_1");
    const retried = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "contact_1", eventId: "evt-9" }),
      harness.deps,
    );
    expect(retried.status).toBe(202);
    const duplicate = await handleGhlWebhook(
      post({ locationId: "loc_1", contactId: "contact_1", eventId: "evt-9" }),
      harness.deps,
    );
    expect(await duplicate.json()).toEqual({ accepted: true, duplicate: true });
    expect(harness.listCalls()).toBe(1);
  });

  it("returns 400 for a body that is not a location and contact nudge", async () => {
    const harness = deps();
    expect((await handleGhlWebhook(post({ locationId: "loc_1" }), harness.deps)).status).toBe(400);
    const request = new Request("https://example.test/api/webhooks/ghl", { method: "POST", body: "{" });
    expect((await handleGhlWebhook(request, harness.deps)).status).toBe(400);
    const method = await handleGhlWebhook(new Request("https://example.test/api/webhooks/ghl"), harness.deps);
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");
  });
});

describe("POST /api/webhooks/ghl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports misconfiguration instead of calling GoHighLevel", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TENANT_KEY_ENCRYPTION_KEY", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    const response = await POST(post({ locationId: "loc_1", contactId: "c" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "misconfigured" });
  });

  it("returns 405 with Allow: POST for non-POST methods", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TENANT_KEY_ENCRYPTION_KEY", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS, HEAD]) {
      const response = await handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(await response.json()).toEqual({ error: "method_not_allowed" });
    }
    const posted = await POST(new Request("https://example.test/api/webhooks/ghl", { method: "GET" }));
    expect(posted.status).toBe(405);
    expect(posted.headers.get("allow")).toBe("POST");
  });
});
