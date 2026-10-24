import type { Tenant, TenantStore } from "./types";

export class MemoryTenantStore implements TenantStore {
  private readonly tenants = new Map<string, Tenant>();

  async getByLocationId(locationId: string): Promise<Tenant | null> {
    const tenant = this.tenants.get(locationId);
    return tenant ? cloneTenant(tenant) : null;
  }

  async listActive(): Promise<Tenant[]> {
    return [...this.tenants.values()]
      .filter((tenant) => tenant.active)
      .sort((a, b) => a.locationId.localeCompare(b.locationId))
      .map(cloneTenant);
  }

  async upsert(tenant: Tenant): Promise<void> {
    this.tenants.set(tenant.locationId, cloneTenant(tenant));
  }
}

function cloneTenant(tenant: Tenant): Tenant {
  return { ...tenant };
}
