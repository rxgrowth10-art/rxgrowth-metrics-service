import type { GhlClient } from "../ghl/index.js";
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
  if (!ids) return json({ error: "locationId and contactId are required" }, 400);

  const tenant = await deps.tenants.getByLocationId(ids.locationId);
  if (!tenant || !tenant.active) {
    const reason = tenant ? "inactive_tenant" : "unknown_tenant";
    log("info", "webhook.skipped", { locationId: ids.locationId, contactId: ids.contactId, reason });
    return json({ accepted: false, reason }, 202);
  }
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
      try {
        await runUntilQuiet(ids, tenant, deps, rerunKey);
      } finally {
        await deps.idempotency.del(lockKey);
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
  });
  return { written: result.written };
}

function authorized(request: Request, tenant: Tenant): boolean {
  if (!tenant.webhookTokenHash) return false;
  return webhookTokenMatches(readWebhookToken(request), tenant.webhookTokenHash);
}

function readIds(body: unknown): { locationId: string; contactId: string } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const locationId = record.locationId;
  const contactId = record.contactId;
  if (typeof locationId !== "string" || !locationId.trim()) return null;
  if (typeof contactId !== "string" || !contactId.trim()) return null;
  return { locationId: locationId.trim(), contactId: contactId.trim() };
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
