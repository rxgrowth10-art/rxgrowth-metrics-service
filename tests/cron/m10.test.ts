import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../api/cron/m10.js";
import { handleM10Cron, type M10Deps } from "../../src/cron/m10.js";
import type { CustomFieldWrite, GhlClient, GhlContact } from "../../src/ghl/index.js";
import { parseContactPage } from "../../src/ghl/parse.js";
import { MemoryIdempotencyStore } from "../../src/idempotency/index.js";
import { FIELDS } from "../../src/schema/fields.js";
import { encryptApiKey, MemoryTenantStore, parseEncryptionKey, type Tenant } from "../../src/tenants/index.js";

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
    webhookTokenHash: null,
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

function harness(options?: {
  enroll?: boolean;
  contacts?: GhlContact[];
  failSearch?: boolean;
  failEnrollTimes?: number;
}) {
  const tenants = new MemoryTenantStore();
  const updates: Array<{ contactId: string; fields: CustomFieldWrite[] }> = [];
  const enrollments: string[] = [];
  let searches = 0;
  let enrollFailuresLeft = options?.failEnrollTimes ?? 0;
  const ghl: GhlClient = {
    async listOrders() {
      throw new Error("m10 must not refetch orders");
    },
    async getOrder() {
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
      const person = options?.contacts?.find((item) => item.id === contactId);
      if (!person) return;
      for (const field of fields) {
        const existing = person.customFields.find((item) => item.id === field.id);
        if (existing) existing.value = field.value;
        else person.customFields.push({ id: field.id, key: field.key, value: field.value });
      }
    },
    async searchContacts() {
      searches += 1;
      if (options?.failSearch && searches === 1) throw new Error("search failed");
      return options?.contacts ?? [];
    },
    async addContactToWorkflow(contactId, workflowId) {
      if (enrollFailuresLeft > 0) {
        enrollFailuresLeft -= 1;
        throw new Error("workflow down");
      }
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

function setContactValue(person: GhlContact, key: string, value: string): void {
  const field = FIELDS.find((item) => item.key === key);
  const existing = person.customFields.find((item) => item.id === field?.testLabId);
  if (!existing) throw new Error(key);
  existing.value = value;
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

  it("retries workflow enrollment on a later day after eligibility was already written", async () => {
    let now = new Date("2026-06-22T12:00:00.000Z");
    const run = harness({
      enroll: true,
      failEnrollTimes: 1,
      contacts: [
        contact("retry", {
          qualifying_order_count: "3",
          last_order_date: "2026-05-25",
          typical_order_interval_days: "14",
          winback_eligibility: "Not Eligible",
          winback_tier: "None",
        }),
      ],
    });
    run.deps.now = () => now;
    await run.tenants.upsert(tenant());

    const first = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(await first.json()).toMatchObject({ written: 1, enrolled: 0, errors: 1 });
    expect(run.updates[0]?.fields.map((field) => field.value)).toEqual(["Eligible", "High"]);
    expect(run.enrollments).toEqual([]);
    expect(await run.deps.idempotency.get("m10enroll:loc_1:retry")).toBeNull();

    now = new Date("2026-06-23T12:00:00.000Z");
    const second = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(await second.json()).toMatchObject({ written: 0, enrolled: 1, errors: 0, skippedUnchanged: 1 });
    expect(run.enrollments).toEqual(["retry:wf_m10"]);

    now = new Date("2026-06-24T12:00:00.000Z");
    const third = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(await third.json()).toMatchObject({ written: 0, enrolled: 0 });
    expect(run.enrollments).toEqual(["retry:wf_m10"]);
  });

  it("enrolls again after the contact leaves eligibility and returns", async () => {
    let now = new Date("2026-06-22T12:00:00.000Z");
    const person = contact("cycle", {
      qualifying_order_count: "3",
      last_order_date: "2026-05-25",
      typical_order_interval_days: "14",
      winback_eligibility: "Not Eligible",
      winback_tier: "None",
    });
    const run = harness({ enroll: true, contacts: [person] });
    run.deps.now = () => now;
    await run.tenants.upsert(tenant());
    await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(run.enrollments).toEqual(["cycle:wf_m10"]);
    expect(await run.deps.idempotency.get("m10enroll:loc_1:cycle")).toBe("1");

    setContactValue(person, "qualifying_order_count", "2");
    now = new Date("2026-06-23T12:00:00.000Z");
    const dropped = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(await dropped.json()).toMatchObject({ written: 1, enrolled: 0 });
    expect(await run.deps.idempotency.get("m10enroll:loc_1:cycle")).toBeNull();

    setContactValue(person, "qualifying_order_count", "3");
    now = new Date("2026-06-24T12:00:00.000Z");
    const returned = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(await returned.json()).toMatchObject({ enrolled: 1 });
    expect(run.enrollments).toEqual(["cycle:wf_m10", "cycle:wf_m10"]);
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

  it("keeps a Chicago search midnight on 2026-10-21 so twenty days stays Not Eligible", async () => {
    const run = harness({
      contacts: [
        contact("chicago", {
          qualifying_order_count: "3",
          last_order_date: "2026-10-21T00:00:00.000Z",
          typical_order_interval_days: "14",
        }),
      ],
    });
    run.deps.now = () => new Date("2026-11-10T18:00:00.000Z");
    await run.tenants.upsert(tenant({ timezone: "America/Chicago" }));
    const response = await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(response.status).toBe(200);
    expect(run.updates[0]?.fields.map((field) => field.value)).toEqual(["Not Eligible", "None"]);
  });

  it("reads every search DATE shape as 2026-10-21 for a timezone behind UTC", async () => {
    const page = parseContactPage(JSON.parse(readFileSync("fixtures/contact-search-dates.json", "utf8")) as unknown);
    const contacts = page.contacts.map((person) => {
      const last = person.customFields.find((field) => field.id === "WUgA196HILTt2ul6vfqf")?.value;
      if (!person.id || !last) throw new Error("fixture contact is missing an id or last_order_date");
      return contact(person.id, {
        qualifying_order_count: "3",
        last_order_date: last,
        typical_order_interval_days: "14",
      });
    });
    const run = harness({ contacts });
    run.deps.now = () => new Date("2026-11-10T18:00:00.000Z");
    await run.tenants.upsert(tenant({ timezone: "America/Chicago" }));
    await handleM10Cron(cronRequest("Bearer cron-secret"), run.deps);
    expect(run.updates).toHaveLength(4);
    for (const update of run.updates) {
      expect(update.fields.map((field) => field.value)).toEqual(["Not Eligible", "None"]);
    }
  });
});

describe("GET /api/cron/m10", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not run without configuration", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TENANT_KEY_ENCRYPTION_KEY", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    const response = await GET(cronRequest("Bearer cron-secret"));
    expect(response.status).toBe(500);
  });
});
