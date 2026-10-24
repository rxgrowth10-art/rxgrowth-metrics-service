export interface Tenant {
  locationId: string;
  name: string;
  apiKeyEncrypted: string;
  timezone: string;
  currency: string;
  m10WorkflowId: string | null;
  active: boolean;
}

export interface TenantStore {
  getByLocationId(locationId: string): Promise<Tenant | null>;
  listActive(): Promise<Tenant[]>;
  upsert(tenant: Tenant): Promise<void>;
}
