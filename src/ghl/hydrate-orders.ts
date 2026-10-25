import type { GhlOrder } from "./types.js";

export const ORDER_DETAIL_CONCURRENCY = 4;

/** List items from this account include paymentStatus and liveMode. Detail is only a fallback. */
export function orderNeedsDetail(order: GhlOrder): boolean {
  const paymentMissing = order.paymentStatus === null || order.paymentStatus.trim() === "";
  const liveMissing = order.liveMode === null;
  return paymentMissing || liveMissing;
}

/**
 * Fills paymentStatus and liveMode from GET /payments/orders/{id} when the list item omitted them.
 * A missing markAsTest is not a reason to fetch and does not disqualify the order.
 * A failed or empty detail throws so the order is not silently treated as non-qualifying.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const job = cursor;
      cursor += 1;
      if (job >= items.length) return;
      const item = items[job];
      if (item === undefined) return;
      await task(item);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

export async function hydrateOrders(
  orders: readonly GhlOrder[],
  getOrder: (orderId: string) => Promise<GhlOrder | null>,
  concurrency = ORDER_DETAIL_CONCURRENCY,
): Promise<GhlOrder[]> {
  const next = orders.map((order) => ({ ...order }));
  const pending: number[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const order = next[index];
    if (!order || !orderNeedsDetail(order)) continue;
    if (!order.id) throw new Error("Order is missing paymentStatus or liveMode and has no id");
    pending.push(index);
  }
  await runWithConcurrency(pending, concurrency, async (index) => {
    const listed = next[index];
    if (!listed?.id) return;
    const detail = await getOrder(listed.id);
    if (!detail) throw new Error("Order detail was empty");
    next[index] = mergeOrder(listed, detail.id ? detail : { ...detail, id: listed.id });
  });
  return next;
}

function mergeOrder(listed: GhlOrder, detail: GhlOrder): GhlOrder {
  return {
    id: detail.id ?? listed.id,
    contactId: detail.contactId ?? listed.contactId,
    status: detail.status ?? listed.status,
    paymentStatus: detail.paymentStatus ?? listed.paymentStatus,
    fulfillmentStatus: detail.fulfillmentStatus ?? listed.fulfillmentStatus,
    liveMode: detail.liveMode ?? listed.liveMode,
    markAsTest: detail.markAsTest ?? listed.markAsTest,
    amount: detail.amount ?? listed.amount,
    sourceName: detail.sourceName ?? listed.sourceName,
    sourceSubType: detail.sourceSubType ?? listed.sourceSubType,
    sourceType: detail.sourceType ?? listed.sourceType,
    deliveryMethod: detail.deliveryMethod ?? listed.deliveryMethod,
    branchName: detail.branchName ?? listed.branchName,
    items: detail.items.length > 0 ? detail.items : listed.items,
    couponCode: detail.couponCode ?? listed.couponCode,
    createdAt: detail.createdAt ?? listed.createdAt,
    updatedAt: detail.updatedAt ?? listed.updatedAt,
    currency: detail.currency ?? listed.currency,
  };
}
