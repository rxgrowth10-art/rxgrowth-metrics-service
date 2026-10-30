import type { OrderDetailSummary, OrderLine } from "../metrics/types.js";

export interface GhlOrder {
  id: string | null;
  contactId: string | null;
  status: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  liveMode: boolean | null;
  markAsTest: boolean | null;
  amount: number | string | null;
  sourceName: string | null;
  sourceSubType: string | null;
  /** `sourceType`, or `source.type` when the flat field is absent. */
  sourceType: string | null;
  /** Checkout choice from order detail `delivery.method`. Absent on the list payload. */
  deliveryMethod: string | null;
  /** Branch name from the order detail. Null when the detail has no branch field. */
  branchName: string | null;
  /** Line items from order detail. The list payload has none. */
  items: OrderLine[];
  /** Coupon code from the detail when one is present. This service does not write it. */
  couponCode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  currency: string | null;
  /** Filled by the summary cache. Metrics do not read it. */
  detailSummary?: OrderDetailSummary | null;
}

export interface GhlContactField {
  id: string | null;
  key: string | null;
  value: string | null;
}

export interface GhlContact {
  id: string;
  customFields: GhlContactField[];
}

export interface GhlContactPage {
  contacts: GhlContact[];
  searchAfter: unknown[] | null;
}

export interface GhlOrderPage {
  orders: GhlOrder[];
  totalCount: number | null;
}

export interface GhlCustomField {
  id: string;
  fieldKey: string;
  name: string;
  dataType: string;
}

/** One product collection. `name` is null when the payload has no usable title. */
export interface GhlCollection {
  id: string;
  name: string | null;
}

export interface CustomFieldWrite {
  id: string;
  key: string;
  value: string;
}

export interface GhlClient {
  listOrders(contactId: string): Promise<GhlOrder[]>;
  /** One location-wide page. `GET /payments/orders` has no sort parameter. */
  listLocationOrdersPage(offset: number): Promise<GhlOrderPage>;
  getOrder(orderId: string): Promise<GhlOrder | null>;
  getContact(contactId: string): Promise<GhlContact>;
  listCustomFields(): Promise<GhlCustomField[]>;
  /**
   * Names for the given collection ids. One request per 100 ids.
   * `GET /products/collections` with `altId`, `altType=location`, and `collectionIds`.
   */
  listCollections(collectionIds: readonly string[]): Promise<GhlCollection[]>;
  updateContact(contactId: string, fields: readonly CustomFieldWrite[]): Promise<void>;
  searchContacts(): Promise<GhlContact[]>;
  searchContactsPage(searchAfter: readonly unknown[] | null): Promise<GhlContactPage>;
  addContactToWorkflow(contactId: string, workflowId: string, eventStartTime?: string): Promise<void>;
}
