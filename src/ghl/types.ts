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
  /** Checkout choice from order detail `delivery.method`. Absent on the list payload. */
  deliveryMethod: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  currency: string | null;
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
  updateContact(contactId: string, fields: readonly CustomFieldWrite[]): Promise<void>;
  searchContacts(): Promise<GhlContact[]>;
  searchContactsPage(searchAfter: readonly unknown[] | null): Promise<GhlContactPage>;
  addContactToWorkflow(contactId: string, workflowId: string, eventStartTime?: string): Promise<void>;
}
