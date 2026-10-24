import { ORDER_PAGE_SIZE, type GhlClient, type GhlOrder } from "../ghl/index.js";
import type { IdempotencyStore } from "../idempotency/index.js";
import { log } from "../log/logger.js";
import { parseInstant } from "../time/business-date.js";
import type { Tenant } from "../tenants/index.js";
import { runLockedM06 } from "../writeback/recompute.js";
import type { M10Deps, M10Summary } from "./m10.js";

export const DEFAULT_RECONCILE_HOURS = 48;
export const MAX_RECONCILE_PAGES = 30;
const RECONCILE_DONE_TTL_SECONDS = 60 * 60 * 36;
const RECONCILE_CURSOR_TTL_SECONDS = 60 * 60 * 2;

interface ReconcileCursor {
  done?: boolean;
  offset?: number;
  seen?: string[];
}

export function readReconcileHours(env: NodeJS.ProcessEnv): number {
  const raw = env.M06_RECONCILE_HOURS?.trim();
  if (!raw) return DEFAULT_RECONCILE_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RECONCILE_HOURS;
  return value;
}

export function readReconcileMaxPages(env: NodeJS.ProcessEnv): number {
  const raw = env.M06_RECONCILE_MAX_PAGES?.trim();
  if (!raw) return MAX_RECONCILE_PAGES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return MAX_RECONCILE_PAGES;
  return value;
}

export function orderTouchesWindow(order: { updatedAt?: string | null; createdAt?: string | null }, now: Date, hours: number): boolean {
  const instant = parseInstant(order.updatedAt) ?? parseInstant(order.createdAt);
  if (!instant) return false;
  const ageMs = now.getTime() - instant.getTime();
  return ageMs >= 0 && ageMs <= hours * 3_600_000;
}

/**
 * Scan location orders for contacts touched inside the reconcile window and
 * recompute M06 before win-back eligibility. Returns true when this hop should
 * stop and continue later.
 *
 * The list is newest-first by createdAt, not updatedAt. startAt/endAt select
 * whole createdAt days in the location timezone, so they miss a recent update
 * on an older order. The scan keeps offset order, limit 100, and the updatedAt
 * filter, and stops after the page cap.
 */
export async function reconcileRecentOrders(args: {
  client: GhlClient;
  tenant: Tenant;
  deps: M10Deps;
  idempotency: IdempotencyStore;
  day: string;
  startedMs: number;
  budgetMs: number;
  summary: M10Summary;
  fresh: Map<string, Record<string, string>>;
}): Promise<boolean> {
  const key = reconcileKey(args.tenant.locationId, args.day);
  const existing = await readReconcileCursor(args.idempotency, key);
  if (existing?.done) return false;
  const hours = args.deps.reconcileHours ?? DEFAULT_RECONCILE_HOURS;
  const cap = args.deps.reconcilePageCap ?? MAX_RECONCILE_PAGES;
  let offset = existing?.offset ?? 0;
  const seen = new Set(existing?.seen ?? []);
  let pages = 0;
  const now = () => args.deps.now();
  const overBudget = () => now().getTime() - args.startedMs >= args.budgetMs;
  while (pages < cap) {
    const page = await args.client.listLocationOrdersPage(offset);
    pages += 1;
    let progressed = false;
    for (let index = 0; index < page.orders.length; index += 1) {
      const order = page.orders[index];
      if (order && needsReconcile(order, now(), hours, seen)) {
        seen.add(order.contactId);
        const result = await runLockedM06({
          client: args.client,
          contactId: order.contactId,
          locationId: args.tenant.locationId,
          timeZone: args.tenant.timezone,
          now: now(),
          idempotency: args.idempotency,
        });
        if (result.status === "written") args.summary.reconciled += 1;
        if (result.status === "unchanged") args.summary.reconcileUnchanged += 1;
        if (result.status === "failed") args.summary.errors += 1;
        if (result.values) args.fresh.set(order.contactId, result.values);
        progressed = true;
      }
      if (!progressed || !overBudget()) continue;
      if (pendingLater(page.orders, index + 1, now(), hours, seen)) {
        await saveCursor(args.idempotency, key, { offset, seen: [...seen] });
        return true;
      }
    }
    const nextOffset = offset + page.orders.length;
    const finished =
      page.orders.length === 0 ||
      (page.totalCount !== null && nextOffset >= page.totalCount) ||
      (page.totalCount === null && page.orders.length < ORDER_PAGE_SIZE);
    if (finished) {
      await args.idempotency.set(key, JSON.stringify({ done: true }), RECONCILE_DONE_TTL_SECONDS);
      log("info", "m06.reconcile_finished", {
        locationId: args.tenant.locationId,
        reconciled: args.summary.reconciled,
        unchanged: args.summary.reconcileUnchanged,
        pages,
      });
      return false;
    }
    if (pages >= cap) {
      const last = page.orders[page.orders.length - 1];
      log("warn", "m06.reconcile_cap", {
        locationId: args.tenant.locationId,
        pages,
        cap,
        offset: nextOffset,
        lastCreatedAt: last?.createdAt ?? null,
      });
      await args.idempotency.set(key, JSON.stringify({ done: true }), RECONCILE_DONE_TTL_SECONDS);
      return false;
    }
    offset = nextOffset;
    if (overBudget()) {
      await saveCursor(args.idempotency, key, { offset, seen: [...seen] });
      return true;
    }
  }
  return false;
}

function needsReconcile(
  order: GhlOrder,
  now: Date,
  hours: number,
  seen: ReadonlySet<string>,
): order is GhlOrder & { contactId: string } {
  return Boolean(order.contactId) && orderTouchesWindow(order, now, hours) && !seen.has(order.contactId ?? "");
}

function pendingLater(
  orders: readonly GhlOrder[],
  start: number,
  now: Date,
  hours: number,
  seen: ReadonlySet<string>,
): boolean {
  for (let index = start; index < orders.length; index += 1) {
    const order = orders[index];
    if (order && needsReconcile(order, now, hours, seen)) return true;
  }
  return false;
}

function reconcileKey(locationId: string, day: string): string {
  return `m06reconcile:${locationId}:${day}`;
}

async function readReconcileCursor(store: IdempotencyStore, key: string): Promise<ReconcileCursor | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReconcileCursor;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCursor(store: IdempotencyStore, key: string, cursor: ReconcileCursor): Promise<void> {
  await store.set(key, JSON.stringify(cursor), RECONCILE_CURSOR_TTL_SECONDS);
}
