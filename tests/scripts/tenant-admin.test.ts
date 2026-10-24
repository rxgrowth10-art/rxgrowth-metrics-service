import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statementsFromSql } from "../../src/admin/sql.js";
import { tenantUpsertPlan } from "../../src/admin/upsert-tenant.js";
import { decryptApiKey, parseEncryptionKey } from "../../src/tenants/crypto.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

describe("SQL migrations", () => {
  it("splits the migration files into executable statements", () => {
    const first = statementsFromSql(readFileSync("migrations/001_tenants.sql", "utf8"));
    const second = statementsFromSql(readFileSync("migrations/002_webhook_token.sql", "utf8"));
    expect(first.some((statement) => statement.startsWith("CREATE TABLE"))).toBe(true);
    expect(first.some((statement) => statement.startsWith("CREATE INDEX"))).toBe(true);
    expect(first.join("\n")).not.toContain("DATABASE_URL");
    expect(second).toEqual([
      "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webhook_token_hash TEXT",
    ]);
  });

  it("refuses to run without DATABASE_URL_UNPOOLED", () => {
    const result = spawnSync("node", ["scripts/migrate.mjs"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL_UNPOOLED: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL_UNPOOLED is not set");
    expect(result.stdout).toBe("");
  });
});

describe("tenant upsert", () => {
  it("encrypts the API key and keeps the webhook token out of the stored row", () => {
    const plan = tenantUpsertPlan(
      {
        DATABASE_URL: "postgres://example",
        TENANT_KEY_ENCRYPTION_KEY: KEY_B64,
        TENANT_LOCATION_ID: "loc_1",
        TENANT_ACTIVE: "false",
      },
      "pit-from-stdin",
    );
    expect(plan.locationId).toBe("loc_1");
    expect(plan.params[0]).toBe("loc_1");
    expect(plan.params[1]).toBe("loc_1");
    expect(plan.params[3]).toBe("UTC");
    expect(plan.params[4]).toBe("USD");
    expect(plan.params[5]).toBeNull();
    expect(plan.params[7]).toBe(false);
    expect(plan.params[2]).not.toContain("pit-from-stdin");
    expect(decryptApiKey(String(plan.params[2]), parseEncryptionKey(KEY_B64))).toBe("pit-from-stdin");
    expect(plan.params[6]).toBe(createHash("sha256").update(plan.token, "utf8").digest("hex"));
    expect(JSON.stringify(plan.params)).not.toContain(plan.token);
  });

  it("exits before printing a token when configuration is missing", () => {
    const missingUrl = spawnSync("node", ["scripts/upsert-tenant.mjs"], {
      encoding: "utf8",
      input: "pit-secret",
      env: {
        ...process.env,
        DATABASE_URL: "",
        TENANT_KEY_ENCRYPTION_KEY: KEY_B64,
        TENANT_LOCATION_ID: "loc_1",
      },
    });
    expect(missingUrl.status).toBe(1);
    expect(missingUrl.stderr).toContain("DATABASE_URL is not set");
    expect(missingUrl.stdout).toBe("");
    expect(missingUrl.stderr).not.toContain("pit-secret");

    const missingKey = spawnSync("node", ["scripts/upsert-tenant.mjs"], {
      encoding: "utf8",
      input: "",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://example",
        TENANT_KEY_ENCRYPTION_KEY: KEY_B64,
        TENANT_LOCATION_ID: "loc_1",
      },
    });
    expect(missingKey.status).toBe(1);
    expect(missingKey.stderr).toContain("Pass the GoHighLevel API key on stdin");
    expect(missingKey.stdout).toBe("");
    expect(missingKey.stderr).not.toContain("Webhook token printed once");
  });
});
