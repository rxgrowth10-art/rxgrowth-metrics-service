export interface Tenant {
  locationId: string;
  name: string;
  apiKeyEncrypted: string;
  timezone: string;
  currency: string;
  m10WorkflowId: string | null;
  /** SHA-256 hex of the per-tenant webhook query token. Null rejects the webhook in every environment. */
  webhookTokenHash: string | null;
  active: boolean;
}

export interface TenantStore {
  getByLocationId(locationId: string): Promise<Tenant | null>;
  listActive(): Promise<Tenant[]>;
  upsert(tenant: Tenant): Promise<void>;
}
