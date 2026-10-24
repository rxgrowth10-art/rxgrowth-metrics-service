import type { GhlClient, GhlContact } from "../ghl/index.js";
import { bearerMatches } from "../http/auth.js";
import { json } from "../http/json.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import { evaluateWinback, type WinbackDecision } from "../metrics/winback.js";
import type { Tenant, TenantStore } from "../tenants/index.js";
import { decryptApiKey } from "../tenants/index.js";
import { businessDateString, calendarDayDifference, parseStoredDate } from "../time/business-date.js";
import { invalidateFieldCache, isUnknownFieldError, loadFieldIdMap } from "../writeback/field-cache.js";
import { readContactField, requireFieldId } from "../writeback/fields.js";

const LOCK_TTL_SECONDS = 120;
const CURSOR_TTL_SECONDS = 60 * 60 * 2;
const ENROLL_TTL_SECONDS = 60 * 60 * 24 * 180;
const DEFAULT_BUDGET_MS = 240_000;
const MAX_INLINE_HOPS = 50;

export interface M10Deps {
  tenants: TenantStore;
  idempotency: IdempotencyStore;
  encryptionKey: Buffer;
  cronSecret: string | null;
  enrollEnabled: boolean;
  ghlFactory: (args: { apiKey: string; locationId: string }) => GhlClient;
  now: () => Date;
  /** Stop a tenant hop after this many milliseconds and leave a cursor. Default 240s. */
  budgetMs?: number;
  /**
   * When set, the dispatcher asks this function to run each active tenant
   * instead of walking them inside the cron invocation.
   */
  invokeTenant?: (locationId: string) => Promise<M10Summary>;
  /** Fired after a tenant hop that still has contacts left. */
  scheduleContinuation?: (locationId: string) => void | Promise<void>;
}

export interface M10Summary {
  tenants: number;
  contacts: number;
  written: number;
  skippedUnchanged: number;
  skippedInProgress: number;
  skippedNoOrders: number;
  skippedLock: number;
  enrolled: number;
  errors: number;
}

export interface M10TenantResult {
  summary: M10Summary;
  continue: boolean;
}

export async function handleM10Cron(request: Request, deps: M10Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!deps.cronSecret || !bearerMatches(request.headers.get("authorization"), deps.cronSecret)) {
    log("warn", "m10.unauthorized", { configured: Boolean(deps.cronSecret) });
    return json({ error: "unauthorized" }, 401);
  }
  const summary = await runM10Cron(deps);
  log("info", "m10.finished", { ...summary });
  return json({ ok: true, ...summary });
}

export async function handleM10Tenant(request: Request, deps: M10Deps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!deps.cronSecret || !bearerMatches(request.headers.get("authorization"), deps.cronSecret)) {
    log("warn", "m10.unauthorized", { configured: Boolean(deps.cronSecret) });
    return json({ error: "unauthorized" }, 401);
  }
  const locationId = new URL(request.url).searchParams.get("locationId")?.trim() ?? "";
  if (!locationId) return json({ error: "location_required" }, 400);
  const tenant = await deps.tenants.getByLocationId(locationId);
  if (!tenant?.active) {
    log("info", "m10.tenant_skipped", { locationId });
    return json({ ok: true, continue: false, ...emptySummary() });
  }
  const result = await runM10Tenant(deps, tenant);
  if (result.continue) await deps.scheduleContinuation?.(tenant.locationId);
  log("info", "m10.tenant_finished", { locationId, continue: result.continue, ...result.summary });
  return json({ ok: true, continue: result.continue, ...result.summary });
}

export async function runM10Cron(deps: M10Deps): Promise<M10Summary> {
  const tenants = await deps.tenants.listActive();
  if (deps.invokeTenant) {
    const invokeTenant = deps.invokeTenant;
    return mergeSummaries(await Promise.all(tenants.map((tenant) => invokeTenant(tenant.locationId))));
  }
  const summary = emptySummary();
  for (const tenant of tenants) {
    let hops = 0;
    let result: M10TenantResult;
    do {
      result = await runM10Tenant(deps, tenant);
      addSummary(summary, result.summary, hops === 0);
      hops += 1;
    } while (result.continue && hops < MAX_INLINE_HOPS);
  }
  return summary;
}

export async function runM10Tenant(deps: M10Deps, tenant: Tenant): Promise<M10TenantResult> {
  const summary = emptySummary();
  summary.tenants = 1;
  const day = businessDateString(deps.now(), tenant.timezone);
  if (!day) {
    summary.errors += 1;
    log("error", "m10.bad_timezone", { locationId: tenant.locationId, timezone: tenant.timezone });
    return { summary, continue: false };
  }
  const lockKey = `m10:${tenant.locationId}:${day}`;
  if (!(await deps.idempotency.setNx(lockKey, LOCK_TTL_SECONDS))) {
    summary.skippedLock += 1;
    return { summary, continue: false };
  }
  let resume = false;
  try {
    const apiKey = decryptApiKey(tenant.apiKeyEncrypted, deps.encryptionKey);
    const client = deps.ghlFactory({ apiKey, locationId: tenant.locationId });
    resume = await runTenant(client, tenant, deps, summary, day);
  } catch (error) {
    summary.errors += 1;
    resume = false;
    await deps.idempotency.del(cursorKey(tenant.locationId, day));
    if (isUnknownFieldError(error)) await invalidateFieldCache(deps.idempotency, tenant.locationId);
    log("error", "m10.tenant_failed", {
      locationId: tenant.locationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    await deps.idempotency.del(lockKey);
  }
  return { summary, continue: resume };
}

async function runTenant(
  client: GhlClient,
  tenant: Tenant,
  deps: M10Deps,
  summary: M10Summary,
  day: string,
): Promise<boolean> {
  const ids = await loadFieldIdMap(client, deps.idempotency, tenant.locationId);
  requireFieldId(ids, "winback_eligibility");
  requireFieldId(ids, "winback_tier");
  const started = deps.now().getTime();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  let cursor = await readCursor(deps, tenant.locationId, day);
  for (let page = 0; page < MAX_INLINE_HOPS; page += 1) {
    const batch = await client.searchContactsPage(cursor);
    for (const contact of batch.contacts) await processContact(client, tenant, deps, summary, ids, contact);
    const next = batch.searchAfter;
    const stuck = cursor !== null && next !== null && JSON.stringify(cursor) === JSON.stringify(next);
    if (!next || next.length === 0 || stuck) {
      await deps.idempotency.del(cursorKey(tenant.locationId, day));
      return false;
    }
    if (deps.now().getTime() - started >= budget) {
      await deps.idempotency.set(cursorKey(tenant.locationId, day), JSON.stringify(next), CURSOR_TTL_SECONDS);
      return true;
    }
    cursor = next;
  }
  await deps.idempotency.set(cursorKey(tenant.locationId, day), JSON.stringify(cursor), CURSOR_TTL_SECONDS);
  return true;
}

async function processContact(
  client: GhlClient,
  tenant: Tenant,
  deps: M10Deps,
  summary: M10Summary,
  ids: ReadonlyMap<string, string>,
  contact: GhlContact,
): Promise<void> {
  summary.contacts += 1;
  if (readContactField(contact, "winback_cycle_status", ids) === "In Progress") {
    summary.skippedInProgress += 1;
    return;
  }
  const decision = decisionFromContact(contact, ids, tenant.timezone, deps.now());
  if (!decision) {
    summary.skippedNoOrders += 1;
    return;
  }
  const currentEligibility = readContactField(contact, "winback_eligibility", ids);
  const currentTier = readContactField(contact, "winback_tier", ids);
  await syncEnrollment(client, tenant, contact.id, decision, deps, summary);
  if (currentEligibility === decision.eligibility && currentTier === decision.tier) {
    summary.skippedUnchanged += 1;
    return;
  }
  await client.updateContact(contact.id, [
    {
      id: requireFieldId(ids, "winback_eligibility"),
      key: "winback_eligibility",
      value: decision.eligibility,
    },
    { id: requireFieldId(ids, "winback_tier"), key: "winback_tier", value: decision.tier },
  ]);
  summary.written += 1;
}

function cursorKey(locationId: string, day: string): string {
  return `m10cursor:${locationId}:${day}`;
}

async function readCursor(deps: M10Deps, locationId: string, day: string): Promise<unknown[] | null> {
  const raw = await deps.idempotency.get(cursorKey(locationId, day));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function enrollMarker(locationId: string, contactId: string): string {
  return `m10enroll:${locationId}:${contactId}`;
}

async function syncEnrollment(
  client: GhlClient,
  tenant: Tenant,
  contactId: string,
  decision: WinbackDecision,
  deps: M10Deps,
  summary: M10Summary,
): Promise<void> {
  const marker = enrollMarker(tenant.locationId, contactId);
  if (!decision.eligible) {
    await deps.idempotency.del(marker);
    return;
  }
  if (!deps.enrollEnabled || !tenant.m10WorkflowId) return;
  if (await deps.idempotency.get(marker)) return;
  try {
    await client.addContactToWorkflow(contactId, tenant.m10WorkflowId);
    await deps.idempotency.setNx(marker, ENROLL_TTL_SECONDS);
    summary.enrolled += 1;
  } catch (error) {
    summary.errors += 1;
    log("error", "m10.enroll_failed", {
      locationId: tenant.locationId,
      contactId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export function decisionFromContact(
  contact: GhlContact,
  ids: ReadonlyMap<string, string>,
  timeZone: string,
  now: Date,
): WinbackDecision | null {
  const qualifyingRaw =
    readContactField(contact, "qualifying_order_count", ids) ?? readContactField(contact, "total_orders", ids);
  const lastOrderRaw = readContactField(contact, "last_order_date", ids);
  if (qualifyingRaw === null && lastOrderRaw === null) return null;
  const qualifying = Number(qualifyingRaw ?? 0);
  const today = businessDateString(now, timeZone);
  const lastOrder = lastOrderRaw ? parseStoredDate(lastOrderRaw, timeZone) : null;
  const days =
    lastOrder && today ? Math.max(0, calendarDayDifference(today, lastOrder) ?? 0) : null;
  const typicalRaw = readContactField(contact, "typical_order_interval_days", ids);
  const typical = typicalRaw === null ? null : Number(typicalRaw);
  return evaluateWinback({
    qualifyingOrderCount: Number.isFinite(qualifying) ? qualifying : 0,
    daysSinceLastOrder: days,
    typicalOrderIntervalDays: typical !== null && Number.isFinite(typical) ? typical : null,
  });
}

function addSummary(target: M10Summary, part: M10Summary, includeTenants: boolean): void {
  if (includeTenants) target.tenants += part.tenants;
  target.contacts += part.contacts;
  target.written += part.written;
  target.skippedUnchanged += part.skippedUnchanged;
  target.skippedInProgress += part.skippedInProgress;
  target.skippedNoOrders += part.skippedNoOrders;
  target.skippedLock += part.skippedLock;
  target.enrolled += part.enrolled;
  target.errors += part.errors;
}

function mergeSummaries(parts: M10Summary[]): M10Summary {
  const summary = emptySummary();
  for (const part of parts) addSummary(summary, part, true);
  return summary;
}

function emptySummary(): M10Summary {
  return {
    tenants: 0,
    contacts: 0,
    written: 0,
    skippedUnchanged: 0,
    skippedInProgress: 0,
    skippedNoOrders: 0,
    skippedLock: 0,
    enrolled: 0,
    errors: 0,
  };
}
