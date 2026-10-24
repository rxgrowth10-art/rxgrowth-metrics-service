import { createHash } from "node:crypto";
import type { GhlClient } from "../ghl";
import { headerMatches } from "../http/auth";
import { json } from "../http/json";
import type { IdempotencyStore } from "../idempotency";
import { log } from "../log/logger";
import { decryptApiKey, type TenantStore } from "../tenants";
import { writeM06Metrics } from "../writeback/m06";

const EVENT_TTL_SECONDS = 300;
const LOCK_TTL_SECONDS = 30;

export interface WebhookDeps {
  tenants: TenantStore;
  idempotency: IdempotencyStore;
  encryptionKey: Buffer;
  webhookSecret: string | null;
  ghlFactory: (args: { apiKey: string; locationId: string }) => GhlClient;
  now: () => Date;
}

export async function handleGhlWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (deps.webhookSecret && !headerMatches(request.headers.get("x-webhook-secret"), deps.webhookSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

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

  const eventId = readEventId(body) ?? derivedEventId(ids.locationId, ids.contactId);
  const dedupeKey = `evt:${ids.locationId}:${ids.contactId}:${eventId}`;
  if (!(await deps.idempotency.setNx(dedupeKey, EVENT_TTL_SECONDS))) {
    log("info", "webhook.duplicate", { locationId: ids.locationId, contactId: ids.contactId });
    return json({ accepted: true, duplicate: true }, 202);
  }

  const lockKey = `lock:${ids.locationId}:${ids.contactId}`;
  if (!(await deps.idempotency.setNx(lockKey, LOCK_TTL_SECONDS))) {
    await deps.idempotency.del(dedupeKey);
    log("info", "webhook.locked", { locationId: ids.locationId, contactId: ids.contactId });
    return json({ accepted: false, reason: "contact_locked" }, 503);
  }

  try {
    const apiKey = decryptApiKey(tenant.apiKeyEncrypted, deps.encryptionKey);
    const client = deps.ghlFactory({ apiKey, locationId: tenant.locationId });
    const orders = await client.listOrders(ids.contactId);
    const result = await writeM06Metrics({
      client,
      contactId: ids.contactId,
      orders,
      timeZone: tenant.timezone,
      now: deps.now(),
    });
    log("info", "webhook.processed", {
      locationId: ids.locationId,
      contactId: ids.contactId,
      written: result.written,
    });
    return json({ accepted: true, written: result.written }, 202);
  } catch (error) {
    await deps.idempotency.del(dedupeKey);
    log("error", "webhook.failed", {
      locationId: ids.locationId,
      contactId: ids.contactId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "processing_failed" }, 500);
  } finally {
    await deps.idempotency.del(lockKey);
  }
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

function derivedEventId(locationId: string, contactId: string): string {
  const digest = createHash("sha256").update(`${locationId}:${contactId}`).digest("hex").slice(0, 32);
  return `d${digest}`;
}
