import type { GhlClient } from "../ghl/index.js";
import type { OrderSummaryCache } from "../ghl/order-summary-cache.js";
import { WEBHOOK_DETAIL_FETCH_LIMIT } from "../ghl/resolve-order-summaries.js";
import { ALPHANUMERIC_ID } from "../ids.js";
import { readWebhookToken, webhookTokenMatches } from "../http/webhook-token.js";
import { json } from "../http/json.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import { decryptApiKey, type Tenant, type TenantStore } from "../tenants/index.js";
import {
  CONTACT_LOCK_TTL_SECONDS,
  CONTACT_RERUN_TTL_SECONDS,
  contactLockKey,
  contactRerunKey,
  recomputeM06Contact,
} from "../writeback/recompute.js";

const EVENT_TTL_SECONDS = 300;

export interface WebhookDeps {
  tenants: TenantStore;
  idempotency: IdempotencyStore;
  orderSummaries: OrderSummaryCache;
  encryptionKey: Buffer;
  ghlFactory: (args: { apiKey: string; locationId: string }) => GhlClient;
  now: () => Date;
}

export function methodNotAllowed(): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
}

export async function handleGhlWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const ids = readIds(body);
  if (ids === "invalid") return json({ error: "invalid_id" }, 400);
  if (!ids) return json({ error: "locationId and contactId are required" }, 400);

  const tenant = await deps.tenants.getByLocationId(ids.locationId);
  if (!authorized(request, tenant)) {
    log("warn", "webhook.unauthorized", { locationId: ids.locationId, contactId: ids.contactId });
    return json({ error: "unauthorized" }, 401);
  }

  const eventId = readEventId(body);
  const dedupeKey = eventId ? `evt:${ids.locationId}:${ids.contactId}:${eventId}` : null;
  if (dedupeKey && !(await deps.idempotency.setNx(dedupeKey, EVENT_TTL_SECONDS))) {
    log("info", "webhook.duplicate", { locationId: ids.locationId, contactId: ids.contactId });
    return json({ accepted: true, duplicate: true }, 202);
  }

  const lockKey = contactLockKey(ids.locationId, ids.contactId);
  const rerunKey = contactRerunKey(ids.locationId, ids.contactId);
  if (!(await deps.idempotency.setNx(lockKey, CONTACT_LOCK_TTL_SECONDS))) {
    await deps.idempotency.set(rerunKey, "1", CONTACT_RERUN_TTL_SECONDS);
    if (dedupeKey) await deps.idempotency.del(dedupeKey);
    log("info", "webhook.queued", { locationId: ids.locationId, contactId: ids.contactId });
    return json({ accepted: true, queued: true }, 202);
  }

  try {
    const outcome = await runUntilQuiet(ids, tenant, deps, rerunKey);
    if (!outcome.ok) {
      if (dedupeKey) await deps.idempotency.del(dedupeKey);
      log("error", "webhook.failed", {
        locationId: ids.locationId,
        contactId: ids.contactId,
        message: outcome.message,
      });
      return json({ error: "processing_failed" }, 500);
    }
    log("info", "webhook.processed", {
      locationId: ids.locationId,
      contactId: ids.contactId,
      written: outcome.written,
    });
    return json({ accepted: true, written: outcome.written }, 202);
  } finally {
    await deps.idempotency.del(lockKey);
    if ((await deps.idempotency.get(rerunKey)) && (await deps.idempotency.setNx(lockKey, CONTACT_LOCK_TTL_SECONDS))) {
      let retry: { ok: true; written: boolean } | { ok: false; message: string } = {
        ok: false,
        message: "unknown",
      };
      try {
        retry = await runUntilQuiet(ids, tenant, deps, rerunKey);
      } catch (error) {
        retry = { ok: false, message: error instanceof Error ? error.message : "unknown" };
      } finally {
        try {
          if (!retry.ok) {
            // runUntilQuiet clears the flag before computing. Restore it while the lock is still held
            // so the single queued pass does not become a second recompute.
            await deps.idempotency.set(rerunKey, "1", CONTACT_RERUN_TTL_SECONDS);
            log("error", "webhook.rerun_failed", {
              locationId: ids.locationId,
              contactId: ids.contactId,
              message: retry.message,
            });
          }
        } finally {
          await deps.idempotency.del(lockKey);
        }
      }
    }
  }
}

async function runUntilQuiet(
  ids: { locationId: string; contactId: string },
  tenant: Tenant,
  deps: WebhookDeps,
  rerunKey: string,
): Promise<{ ok: true; written: boolean } | { ok: false; message: string }> {
  let written = false;
  try {
    do {
      await deps.idempotency.del(rerunKey);
      const result = await compute(ids, tenant, deps);
      written = result.written || written;
    } while (await deps.idempotency.get(rerunKey));
    return { ok: true, written };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "unknown" };
  }
}

async function compute(
  ids: { locationId: string; contactId: string },
  tenant: Tenant,
  deps: WebhookDeps,
): Promise<{ written: boolean }> {
  const apiKey = decryptApiKey(tenant.apiKeyEncrypted, deps.encryptionKey);
  const client = deps.ghlFactory({ apiKey, locationId: tenant.locationId });
  const result = await recomputeM06Contact({
    client,
    contactId: ids.contactId,
    locationId: tenant.locationId,
    timeZone: tenant.timezone,
    now: deps.now(),
    idempotency: deps.idempotency,
    orderSummaries: deps.orderSummaries,
    summaryFetchLimit: WEBHOOK_DETAIL_FETCH_LIMIT,
  });
  return { written: result.written };
}

function authorized(request: Request, tenant: Tenant | null): tenant is Tenant {
  const matches = webhookTokenMatches(readWebhookToken(request), tenant?.webhookTokenHash ?? null);
  return Boolean(tenant?.active) && matches;
}

/** A present but illegal id is rejected. An empty value falls through to the next source. */
function readId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!ALPHANUMERIC_ID.test(trimmed)) return null;
  return trimmed;
}

function firstId(...candidates: Array<string | null | undefined>): string | null | "invalid" {
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (candidate === null) return "invalid";
    return candidate;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A standard GoHighLevel Webhook action posts the contact at the top level
 * (`contact_id`, `location.id`) plus the action's key-value pairs under
 * `customData`. The body is not logged; it contains contact PII.
 */
function readIds(body: unknown): { locationId: string; contactId: string } | "invalid" | null {
  const record = asRecord(body);
  if (!record) return null;
  const custom = asRecord(record.customData);
  const location = asRecord(record.location);
  const locationId = firstId(readId(custom?.locationId), readId(record.locationId), readId(location?.id));
  const contactId = firstId(readId(custom?.contactId), readId(record.contactId), readId(record.contact_id));
  if (locationId === "invalid" || contactId === "invalid") return "invalid";
  if (!locationId || !contactId) return null;
  return { locationId, contactId };
}

function readEventId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const raw = record.eventId ?? record.webhookId;
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(cleaned)) return null;
  return cleaned;
}
