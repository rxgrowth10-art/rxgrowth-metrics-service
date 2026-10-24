import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../api/cron/m10";
import { handleM10Cron, type M10Deps } from "../../src/cron/m10";
import type { CustomFieldWrite, GhlClient, GhlContact } from "../../src/ghl";
import { MemoryIdempotencyStore } from "../../src/idempotency";
import { FIELDS } from "../../src/schema/fields";
import { encryptApiKey, MemoryTenantStore, parseEncryptionKey, type Tenant } from "../../src/tenants";

const KEY = parseEncryptionKey(Buffer.alloc(32, 5).toString("base64"));
const NOW = new Date("2026-06-22T12:00:00.000Z");

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    locationId: "loc_1",
    name: "Test Lab",
    apiKeyEncrypted: encryptApiKey("pit-plaintext", KEY),
    timezone: "UTC",
    currency: "EGP",
    m10WorkflowId: "wf_m10",
    active: true,
    ...overrides,
  };
}

function contact(id: string, values: Record<string, string>): GhlContact {
  return {
    id,
    customFields: Object.entries(values).map(([key, value]) => {
      const field = FIELDS.find((item) => item.key === key);
      if (!field) throw new Error(key);
      return { id: field.testLabId, key: field.fieldKey, value };
    }),
  };
}

function harness(options?: { enroll?: boolean; contacts?: GhlContact[]; failSearch?: boolean }) {
  const tenants = new MemoryTenantStore();
  const updates: Array<{ contactId: string; fields: CustomFieldWrite[] }> = [];
  const enrollments: string[] = [];
  let searches = 0;
  const ghl: GhlClient = {
    async listOrders() {
      throw new Error("m10 must not refetch orders");
    },
    async getContact() {
      throw new Error("m10 reads search results");
    },
    async listCustomFields() {
      return FIELDS.map((field) => ({
        id: field.testLabId,
        fieldKey: field.fieldKey,
        name: field.name,
        dataType: field.dataType,
      }));
    },
    async updateContact(contactId, fields) {
      updates.push({ contactId, fields: [...fields] });
    },
    async searchContacts() {
      searches += 1;
      if (options?.failSearch && searches === 1) throw new Error("search failed");
      return options?.contacts ?? [];
    },
    async addContactToWorkflow(contactId, workflowId) {
      enrollments.push(`${contactId}:${workflowId}`);
    },
  };
  const deps: M10Deps = {
    tenants,
    idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
    encryptionKey: KEY,
    cronSecret: "cron-secret",
    enrollEnabled: options?.enroll ?? false,
    ghlFactory: () => ghl,
    now: () => NOW,
  };
  return { deps, tenants, updates, enrollments, searches: () => searches };
}

function cronRequest(authorization?: string): Request {
  return new Request("https://example.test/api/cron/m10", {
    headers: authorization ? { authorization } : {},
  });
}

describe("M10 win-back cron", () => {
  it("writes only eligibility and tier, and leaves enrollment off", async () => {
    const run = harness({
      contacts: [
        contact("high", {
          qualifying_order_count: "3",
          total_orders: "1",
          last_order_date: "2026-05-25",
          typical_order_interval_days: "14",
        }),
        contact("medium", {
          qualifying_order_count: "3",
          last_order_date: "2026-06-01",
          typical_order_interval_days: "14",
        }),
        contact("too_few", {
          qualifying_order_count: "2",
          last_order_date: "2026-05-01",
          typical_order_interval_days: "10",
          winback_eligibility: "Eligible",
          winback_tier: "High",
        }),
        contact("in_progress", {
          qualifying_order_count: "5",
          last_order_date: "2026-05-01",
          typical_order_interval_days: "10",
          winback_cycle_status: "In Progress",
          winback_eligibility: "Not Eligible",
        }),
        contact("lead", {}),
        contact("unchanged", {
          qualifying_order_count: "3",
          last_order_date: "2026-06-01",
          typical_order_interval_days: "14",
          winback_eligibility: "Eligible",
          winback_tier: "Medium",
        }),
      ],
    });
    await run.tenants.upsert(tenant());
    const response = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { written: number; skippedInProgress: number; skippedNoOrders: number; enrolled: number };
    expect(body.written).toBe(3);
    expect(body.skippedInProgress).toBe(1);
    expect(body.skippedNoOrders).toBe(1);
    expect(body.enrolled).toBe(0);
    expect(run.enrollments).toEqual([]);
    const written = Object.fromEntries(run.updates.map((update) => [update.contactId, update.fields]));
    expect(written.high?.map((field) => field.key)).toEqual(["winback_eligibility", "winback_tier"]);
    expect(written.high?.map((field) => field.value)).toEqual(["Eligible", "High"]);
    expect(written.medium?.map((field) => field.value)).toEqual(["Eligible", "Medium"]);
    expect(written.too_few?.map((field) => field.value)).toEqual(["Not Eligible", "None"]);
    expect(written.in_progress).toBeUndefined();
    expect(JSON.stringify(run.updates)).not.toContain("winback_cycle");
  });

  it("enrolls only when the flag is on and eligibility newly becomes Eligible", async () => {
    const contacts = [
      contact("new_eligible", {
        qualifying_order_count: "3",
        last_order_date: "2026-05-25",
        typical_order_interval_days: "14",
        winback_eligibility: "Not Eligible",
      }),
    ];
    const off = harness({ contacts });
    await off.tenants.upsert(tenant());
    await handleM10Cron(cronRequest("Bearer cron-secret"), off.deps);
    expect(off.enrollments).toEqual([]);

    const on = harness({ contacts, enroll: true });
    await on.tenants.upsert(tenant());
    const response = await handleM10Cron(cronRequest("Bearer cron-secret"), on.deps);
    expect(((await response.json()) as { enrolled: number }).enrolled).toBe(1);
    expect(on.enrollments).toEqual(["new_eligible:wf_m10"]);
  });

  it("uses the tenant calendar day for the 21-day gate and the daily lock", async () => {
    const run = harness({
      contacts: [
        contact("edge", {
          qualifying_order_count: "3",
          last_order_date: "2026-05-25",
          typical_order_interval_days: "10",
        }),
      ],
    });
    run.deps.now = () => new Date("2026-06-15T03:30:00.000Z");
    await run.tenants.upsert(tenant({ locationId: "loc_ny", timezone: "America/New_York" }));
    const response = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    const body = (await response.json()) as { written: number };
    expect(body.written).toBe(1);
    expect(run.updates[0]?.fields.map((field) => field.value)).toEqual(["Not Eligible", "None"]);

    const locked = harness({ contacts: [] });
    locked.deps.now = () => new Date("2026-06-15T03:30:00.000Z");
    await locked.tenants.upsert(tenant({ locationId: "loc_ny", timezone: "America/New_York" }));
    await locked.deps.idempotency.setNx("m10:loc_ny:2026-06-14", 3600);
    const second = await handleM10Cron(cronRequest("Bearer cron-secret"), locked.deps);
    expect(((await second.json()) as { skippedLock: number }).skippedLock).toBe(1);
    expect(locked.searches()).toBe(0);
  });

  it("rejects missing credentials and a second same-day pass", async () => {
    const run = harness({ contacts: [contact("lead", {})] });
    await run.tenants.upsert(tenant());
    expect((await handleM10Cron(cronRequest(), run.deps)).status).toBe(401);
    expect((await handleM10Cron(cronRequest("Bearer wrong"), run.deps)).status).toBe(401);
    const first = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    const second = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(first.status).toBe(200);
    expect(((await second.json()) as { skippedLock: number }).skippedLock).toBe(1);
    expect(run.searches()).toBe(1);
  });

  it("drops the daily lock when a tenant fails so the next attempt can run", async () => {
    const run = harness({ failSearch: true, contacts: [contact("medium", {
      qualifying_order_count: "3",
      last_order_date: "2026-06-01",
      typical_order_interval_days: "14",
    })] });
    await run.tenants.upsert(tenant());
    const failed = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(((await failed.json()) as { errors: number }).errors).toBe(1);
    const retried = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(((await retried.json()) as { written: number; errors: number }).written).toBe(1);
    expect(run.searches()).toBe(2);
  });
});

describe("GET /api/cron/m10", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not run without configuration", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TENANT_ENCRYPTION_KEY", "");
    const response = await GET(cronRequest("Bearer cron-secret"));
    expect(response.status).toBe(500);
  });
});
