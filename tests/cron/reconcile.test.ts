import { describe, expect, it, vi } from "vitest";
import { runM10Tenant, type M10Deps } from "../../src/cron/m10.js";
import { orderTouchesWindow, readReconcileHours, readReconcileMaxPages } from "../../src/cron/reconcile.js";
import type { CustomFieldWrite, GhlClient, GhlContact, GhlOrder, GhlOrderPage } from "../../src/ghl/index.js";
import { MemoryIdempotencyStore } from "../../src/idempotency/index.js";
import { computeM06 } from "../../src/metrics/index.js";
import { FIELDS, fieldByKey } from "../../src/schema/fields.js";
import { encryptApiKey, MemoryTenantStore, parseEncryptionKey, type Tenant } from "../../src/tenants/index.js";
import { formatM06Values } from "../../src/writeback/format.js";
import { metricsHash } from "../../src/writeback/hash.js";
import { order } from "../helpers/orders.js";

const KEY = parseEncryptionKey(Buffer.alloc(32, 5).toString("base64"));
const NOW = new Date("2026-06-22T12:00:00.000Z");
const IN_WINDOW = "2026-06-22T00:00:00.000Z";
const OUTSIDE = "2026-06-20T10:00:00.000Z";

function tenant(): Tenant {
  return {
    locationId: "loc_1",
    name: "Test Lab",
    apiKeyEncrypted: encryptApiKey("pit-plaintext", KEY),
    timezone: "UTC",
    currency: "EGP",
    m10WorkflowId: "wf_m10",
    webhookTokenHash: null,
    active: true,
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

function valueOf(fields: readonly CustomFieldWrite[] | undefined, key: string): string | undefined {
  return fields?.find((field) => field.key === key)?.value;
}

function harness(options?: {
  pages?: (offset: number) => GhlOrderPage;
  contactOrders?: (contactId: string) => GhlOrder[];
  contacts?: GhlContact[];
  hash?: string | null;
  budgetMs?: number;
  reconcileHours?: number;
  reconcilePageCap?: number;
}) {
  const tenants = new MemoryTenantStore();
  const listed: string[] = [];
  const updates: Array<{ contactId: string; fields: CustomFieldWrite[] }> = [];
  let searches = 0;
  const hashField = fieldByKey("metrics_hash");
  if (!hashField) throw new Error("metrics_hash");
  const ghl: GhlClient = {
    async listLocationOrdersPage(offset) {
      return options?.pages?.(offset) ?? { orders: [], totalCount: 0 };
    },
    async listOrders(contactId) {
      listed.push(contactId);
      return options?.contactOrders?.(contactId) ?? [];
    },
    async getOrder() {
      return order({ deliveryMethod: null, markAsTest: false });
    },
    async getContact(contactId) {
      return {
        id: contactId,
        customFields: options?.hash
          ? [{ id: hashField.testLabId, key: "metrics_hash", value: options.hash }]
          : [],
      };
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
      return options?.contacts ?? [];
    },
    async searchContactsPage() {
      searches += 1;
      return { contacts: options?.contacts ?? [], searchAfter: null };
    },
    async addContactToWorkflow() {
      return undefined;
    },
  };
  const deps: M10Deps = {
    tenants,
    idempotency: new MemoryIdempotencyStore(() => NOW.getTime()),
    encryptionKey: KEY,
    cronSecret: "cron-secret",
    enrollEnabled: false,
    ghlFactory: () => ghl,
    now: () => NOW,
    ...(options?.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
    ...(options?.reconcileHours !== undefined ? { reconcileHours: options.reconcileHours } : {}),
    ...(options?.reconcilePageCap !== undefined ? { reconcilePageCap: options.reconcilePageCap } : {}),
  };
  return { deps, tenants, listed, updates, searches: () => searches };
}

async function run(options?: Parameters<typeof harness>[0]) {
  const built = harness(options);
  await built.tenants.upsert(tenant());
  const result = await runM10Tenant(built.deps, tenant());
  return { ...built, result };
}

describe("readReconcileHours", () => {
  it("defaults to 48 when the env value is missing or invalid", () => {
    expect(readReconcileHours({})).toBe(48);
    expect(readReconcileHours({ M06_RECONCILE_HOURS: "" })).toBe(48);
    expect(readReconcileHours({ M06_RECONCILE_HOURS: "0" })).toBe(48);
    expect(readReconcileHours({ M06_RECONCILE_HOURS: "nope" })).toBe(48);
    expect(readReconcileHours({ M06_RECONCILE_HOURS: "12" })).toBe(12);
  });
});

describe("readReconcileMaxPages", () => {
  it("defaults to 30 when the env value is missing or not a positive integer", () => {
    expect(readReconcileMaxPages({})).toBe(30);
    expect(readReconcileMaxPages({ M06_RECONCILE_MAX_PAGES: "" })).toBe(30);
    expect(readReconcileMaxPages({ M06_RECONCILE_MAX_PAGES: "0" })).toBe(30);
    expect(readReconcileMaxPages({ M06_RECONCILE_MAX_PAGES: "1.5" })).toBe(30);
    expect(readReconcileMaxPages({ M06_RECONCILE_MAX_PAGES: "nope" })).toBe(30);
    expect(readReconcileMaxPages({ M06_RECONCILE_MAX_PAGES: "10" })).toBe(10);
  });
});

describe("orderTouchesWindow", () => {
  it("uses updatedAt, falls back to createdAt, and keeps the inclusive window", () => {
    expect(orderTouchesWindow({ updatedAt: "2026-06-20T12:00:00.000Z" }, NOW, 48)).toBe(true);
    expect(orderTouchesWindow({ updatedAt: "2026-06-20T11:59:59.000Z" }, NOW, 48)).toBe(false);
    expect(orderTouchesWindow({ updatedAt: null, createdAt: IN_WINDOW }, NOW, 48)).toBe(true);
    expect(orderTouchesWindow({ updatedAt: "2026-06-22T13:00:00.000Z", createdAt: IN_WINDOW }, NOW, 48)).toBe(false);
  });
});

describe("M06 order reconcile", () => {
  it("recomputes a cancelled order inside the window and lowers LTV before eligibility", async () => {
    const { result, listed, updates } = await run({
      pages: () => ({
        orders: [
          order({
            id: "cancelled-1",
            contactId: "c1",
            status: "cancelled",
            amount: 50,
            updatedAt: IN_WINDOW,
            createdAt: "2026-05-01T12:00:00.000Z",
          }),
        ],
        totalCount: 1,
      }),
      contactOrders: () => [
        order({
          id: "cancelled-1",
          contactId: "c1",
          status: "cancelled",
          amount: 50,
          updatedAt: IN_WINDOW,
          createdAt: "2026-05-01T12:00:00.000Z",
        }),
        order({
          id: "qual-1",
          contactId: "c1",
          amount: 100,
          createdAt: "2026-01-01T12:00:00.000Z",
          updatedAt: "2026-01-01T12:00:00.000Z",
        }),
      ],
      contacts: [
        contact("c1", {
          qualifying_order_count: "3",
          last_order_date: "2026-05-01",
          typical_order_interval_days: "14",
        }),
      ],
    });
    const metrics = updates.find((update) => update.fields.some((field) => field.key === "lifetime_value"));
    expect(valueOf(metrics?.fields, "lifetime_value")).toBe("100.00");
    expect(valueOf(metrics?.fields, "qualifying_order_count")).toBe("1");
    const winback = updates.find((update) => update.fields.some((field) => field.key === "winback_eligibility"));
    expect(winback?.fields.map((field) => field.value)).toEqual(["Not Eligible", "None"]);
    expect(listed).toEqual(["c1"]);
    expect(result.summary.reconciled).toBe(1);
    expect(result.continue).toBe(false);
  });

  it("ignores orders outside the window, including a future updatedAt", async () => {
    const { result, listed, searches } = await run({
      pages: () => ({
        orders: [
          order({ id: "old", contactId: "c1", status: "cancelled", amount: 50, updatedAt: OUTSIDE, createdAt: OUTSIDE }),
          order({
            id: "future",
            contactId: "c2",
            status: "cancelled",
            updatedAt: "2026-06-22T13:00:00.000Z",
            createdAt: OUTSIDE,
          }),
        ],
        totalCount: 2,
      }),
      contactOrders: () => {
        throw new Error("outside the window");
      },
      contacts: [contact("c1", {})],
    });
    expect(listed).toEqual([]);
    expect(result.summary.reconciled).toBe(0);
    expect(result.summary.contacts).toBe(1);
    expect(searches()).toBe(1);
  });

  it("falls back to createdAt when updatedAt is missing", async () => {
    const { listed, result } = await run({
      pages: () => ({
        orders: [order({ id: "created", contactId: "c1", status: "cancelled", updatedAt: null, createdAt: IN_WINDOW })],
        totalCount: 1,
      }),
      contactOrders: () => [order({ id: "qual-1", contactId: "c1", amount: 20, createdAt: "2026-01-01T12:00:00.000Z" })],
    });
    expect(listed).toEqual(["c1"]);
    expect(result.summary.reconciled).toBe(1);
  });

  it("recomputes each contact once when several in-window orders share a contactId", async () => {
    const { listed, result } = await run({
      pages: () => ({
        orders: [
          order({ id: "o1", contactId: "c1", status: "cancelled", updatedAt: IN_WINDOW }),
          order({ id: "o2", contactId: "c1", status: "refunded", updatedAt: IN_WINDOW }),
        ],
        totalCount: 2,
      }),
      contactOrders: () => [order({ id: "qual-1", contactId: "c1", amount: 20, createdAt: "2026-01-01T12:00:00.000Z" })],
    });
    expect(listed).toEqual(["c1"]);
    expect(result.summary.reconciled).toBe(1);
  });

  it("skips the contact PUT when the metrics hash is unchanged and still uses the fresh values", async () => {
    const orders = [
      order({
        id: "qual-1",
        contactId: "c1",
        amount: 80,
        createdAt: "2026-01-01T12:00:00.000Z",
        updatedAt: IN_WINDOW,
        deliveryMethod: null,
      }),
    ];
    const hash = metricsHash(formatM06Values(computeM06(orders, "UTC", NOW)));
    const { updates, result } = await run({
      hash,
      pages: () => ({ orders, totalCount: 1 }),
      contactOrders: () => orders,
      contacts: [
        contact("c1", {
          qualifying_order_count: "3",
          last_order_date: "2026-05-01",
          typical_order_interval_days: "14",
          winback_eligibility: "Eligible",
          winback_tier: "High",
        }),
      ],
    });
    expect(updates.some((update) => update.fields.some((field) => field.key === "lifetime_value" || field.key === "metrics_hash"))).toBe(
      false,
    );
    const winback = updates.find((update) => update.fields.some((field) => field.key === "winback_eligibility"));
    expect(winback?.fields.map((field) => field.value)).toEqual(["Not Eligible", "None"]);
    expect(result.summary.reconcileUnchanged).toBe(1);
    expect(result.summary.reconciled).toBe(0);
  });

  it("saves a reconcile cursor when the time budget is spent and continues the next page", async () => {
    const first = await run({
      budgetMs: 0,
      pages: (offset) => {
        if (offset === 0) {
          return {
            orders: [order({ id: "a", contactId: "a", status: "cancelled", updatedAt: IN_WINDOW })],
            totalCount: 2,
          };
        }
        return {
          orders: [order({ id: "b", contactId: "b", status: "cancelled", updatedAt: IN_WINDOW })],
          totalCount: 2,
        };
      },
      contactOrders: (contactId) => [
        order({ id: `qual-${contactId}`, contactId, amount: 15, createdAt: "2026-01-01T12:00:00.000Z" }),
      ],
    });
    expect(first.result.continue).toBe(true);
    expect(first.result.summary.reconciled).toBe(1);
    expect(first.searches()).toBe(0);
    expect(first.listed).toEqual(["a"]);
    expect(await first.deps.idempotency.get("m06reconcile:loc_1:2026-06-22")).toBe(
      JSON.stringify({ offset: 1, seen: ["a"] }),
    );

    const second = await runM10Tenant(first.deps, tenant());
    expect(second.continue).toBe(false);
    expect(second.summary.reconciled).toBe(1);
    expect(first.listed).toEqual(["a", "b"]);
    expect(first.searches()).toBe(1);
    const cursor = await first.deps.idempotency.get("m06reconcile:loc_1:2026-06-22");
    expect(cursor && JSON.parse(cursor)).toMatchObject({ done: true });
  });

  it("stops at the page cap, logs without the order payload, and still runs eligibility", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result, searches } = await run({
        reconcilePageCap: 1,
        pages: () => ({
          orders: [
            order({
              id: "newer",
              contactId: "c1",
              status: "cancelled",
              updatedAt: IN_WINDOW,
              createdAt: "2026-06-01T00:00:00.000Z",
              sourceName: "pii-secret-name",
            }),
            order({
              id: "older",
              contactId: "c1",
              status: "completed",
              updatedAt: OUTSIDE,
              createdAt: "2026-03-01T00:00:00.000Z",
            }),
          ],
          totalCount: 1000,
        }),
        contactOrders: () => [order({ id: "qual-1", contactId: "c1", amount: 10, createdAt: "2026-01-01T12:00:00.000Z" })],
        contacts: [contact("c1", {})],
      });
      const lines = [...warn.mock.calls, ...info.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
      expect(lines.join("\n")).not.toContain("pii-secret-name");
      const cap = lines
        .map((line) => {
          try {
            return JSON.parse(line) as { event?: string; data?: Record<string, unknown> };
          } catch {
            return null;
          }
        })
        .find((line) => line?.event === "m06.reconcile_cap");
      expect(cap).toMatchObject({
        data: { locationId: "loc_1", pages: 1, lastCreatedAt: "2026-03-01T00:00:00.000Z" },
      });
      expect(result.summary.contacts).toBe(1);
      expect(searches()).toBe(1);
      expect(result.continue).toBe(false);
    } finally {
      warn.mockRestore();
      info.mockRestore();
      error.mockRestore();
    }
  });
});
