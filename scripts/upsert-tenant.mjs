import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

register(new URL("./resolve-typescript.mjs", import.meta.url));
const { TENANT_UPSERT_SQL, tenantUpsertPlan } = await import("../src/admin/upsert-tenant.js");

function redact(message, secrets) {
  let text = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

async function main() {
  const plaintext = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  let plan;
  try {
    plan = tenantUpsertPlan(process.env, plaintext);
    const sql = neon(plan.databaseUrl);
    await sql.query(TENANT_UPSERT_SQL, plan.params);
  } catch (error) {
    const message = error instanceof Error ? error.message : "tenant upsert failed";
    const secrets = plan ? [plan.databaseUrl, plan.token, plaintext, plan.params[2]] : [plaintext];
    process.stderr.write(`${redact(message, secrets)}\n`);
    process.exit(1);
  }
  process.stdout.write(`upserted ${plan.locationId}\n`);
  process.stderr.write(
    "Webhook token printed once below. It is stored only as a SHA-256 hash. Put the token in the GoHighLevel webhook URL as ?t=\n",
  );
  process.stderr.write(`${plan.token}\n`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) await main();
