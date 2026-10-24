import { neon } from "@neondatabase/serverless";
import type { Tenant, TenantStore } from "./types";

export function createNeonTenantStore(databaseUrl: string): TenantStore {
  const sql = neon(databaseUrl);
  return {
    async getByLocationId(locationId) {
      const rows = await sql`
        SELECT location_id, name, api_key_encrypted, timezone, currency, m10_workflow_id,
               webhook_token_hash, active
        FROM tenants
        WHERE location_id = ${locationId}
        LIMIT 1
      `;
      const row = asRows(rows)[0];
      return row ? mapTenantRow(row) : null;
    },
    async listActive() {
      const rows = await sql`
        SELECT location_id, name, api_key_encrypted, timezone, currency, m10_workflow_id,
               webhook_token_hash, active
        FROM tenants
        WHERE active = TRUE
        ORDER BY location_id
      `;
      return asRows(rows).map(mapTenantRow);
    },
    async upsert(tenant) {
      await sql`
        INSERT INTO tenants (
          location_id,
          name,
          api_key_encrypted,
          timezone,
          currency,
          m10_workflow_id,
          webhook_token_hash,
          active,
          updated_at
        ) VALUES (
          ${tenant.locationId},
          ${tenant.name},
          ${tenant.apiKeyEncrypted},
          ${tenant.timezone},
          ${tenant.currency},
          ${tenant.m10WorkflowId},
          ${tenant.webhookTokenHash},
          ${tenant.active},
          NOW()
        )
        ON CONFLICT (location_id) DO UPDATE SET
          name = EXCLUDED.name,
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          timezone = EXCLUDED.timezone,
          currency = EXCLUDED.currency,
          m10_workflow_id = EXCLUDED.m10_workflow_id,
          webhook_token_hash = EXCLUDED.webhook_token_hash,
          active = EXCLUDED.active,
          updated_at = NOW()
      `;
    },
  };
}

function asRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function mapTenantRow(row: unknown): Tenant {
  if (!row || typeof row !== "object") {
    throw new Error("Tenant row was empty");
  }
  const record = row as Record<string, unknown>;
  const locationId = asString(record.location_id);
  const name = asString(record.name);
  const apiKeyEncrypted = asString(record.api_key_encrypted);
  const timezone = asString(record.timezone);
  const currency = asString(record.currency);
  if (!locationId || !name || !apiKeyEncrypted || !timezone || !currency) {
    throw new Error("Tenant row is missing required columns");
  }
  return {
    locationId,
    name,
    apiKeyEncrypted,
    timezone,
    currency,
    m10WorkflowId: asString(record.m10_workflow_id),
    webhookTokenHash: asString(record.webhook_token_hash),
    active: record.active === true || record.active === "t" || record.active === "true",
  };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}
