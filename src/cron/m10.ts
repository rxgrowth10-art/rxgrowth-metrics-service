import type { GhlClient, GhlContact } from "../ghl";
import { bearerMatches } from "../http/auth";
import { json } from "../http/json";
import type { IdempotencyStore } from "../idempotency";
import { log } from "../log/logger";
import { evaluateWinback, type WinbackDecision } from "../metrics/winback";
import type { Tenant, TenantStore } from "../tenants";
import { decryptApiKey } from "../tenants";
import { businessDateString, calendarDayDifference, parseStoredDate } from "../time/business-date";
import { buildFieldIdMap, readContactField, requireFieldId } from "../writeback/fields";

const LOCK_TTL_SECONDS = 60 * 60 * 36;
const ENROLL_TTL_SECONDS = 60 * 60 * 24 * 180;

export interface M10Deps {
  tenants: TenantStore;
  idempotency: IdempotencyStore;
  encryptionKey: Buffer;
  cronSecret: string | null;
  enrollEnabled: boolean;
  ghlFactory: (args: { apiKey: string; locationId: string }) => GhlClient;
  now: () => Date;
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

export async function runM10Cron(deps: M10Deps): Promise<M10Summary> {
  const summary = emptySummary();
  const tenants = await deps.tenants.listActive();
  for (const tenant of tenants) {
    summary.tenants += 1;
    const day = businessDateString(deps.now(), tenant.timezone);
    if (!day) {
      summary.errors += 1;
      log("error", "m10.bad_timezone", { locationId: tenant.locationId, timezone: tenant.timezone });
      continue;
    }
    const lockKey = `m10:${tenant.locationId}:${day}`;
    if (!(await deps.idempotency.setNx(lockKey, LOCK_TTL_SECONDS))) {
      summary.skippedLock += 1;
      continue;
    }
    try {
      const apiKey = decryptApiKey(tenant.apiKeyEncrypted, deps.encryptionKey);
      const client = deps.ghlFactory({ apiKey, locationId: tenant.locationId });
      await runTenant(client, tenant, deps, summary);
    } catch (error) {
      summary.errors += 1;
      await deps.idempotency.del(lockKey);
      log("error", "m10.tenant_failed", {
        locationId: tenant.locationId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return summary;
}

async function runTenant(client: GhlClient, tenant: Tenant, deps: M10Deps, summary: M10Summary): Promise<void> {
  const ids = buildFieldIdMap(await client.listCustomFields());
  requireFieldId(ids, "winback_eligibility");
  requireFieldId(ids, "winback_tier");
  const contacts = await client.searchContacts();
  for (const contact of contacts) {
    summary.contacts += 1;
    if (readContactField(contact, "winback_cycle_status", ids) === "In Progress") {
      summary.skippedInProgress += 1;
      continue;
    }
    const decision = decisionFromContact(contact, ids, tenant.timezone, deps.now());
    if (!decision) {
      summary.skippedNoOrders += 1;
      continue;
    }
    const currentEligibility = readContactField(contact, "winback_eligibility", ids);
    const currentTier = readContactField(contact, "winback_tier", ids);
    await syncEnrollment(client, tenant, contact.id, decision, deps, summary);
    if (currentEligibility === decision.eligibility && currentTier === decision.tier) {
      summary.skippedUnchanged += 1;
      continue;
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
