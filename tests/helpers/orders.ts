import type { GhlOrder } from "../../src/ghl";

export function order(overrides: Partial<GhlOrder> = {}): GhlOrder {
  return {
    id: null,
    contactId: "contact_1",
    status: "completed",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    liveMode: true,
    markAsTest: false,
    amount: 100,
    sourceName: "Counter",
    sourceSubType: "Pickup",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: null,
    currency: null,
    ...overrides,
  };
}
