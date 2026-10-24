import { handleM10Cron, type M10Summary } from "../../src/cron/m10.js";
import { json } from "../../src/http/json.js";
import { log } from "../../src/log/logger.js";
import { createDefaultDeps } from "../../src/runtime/deps.js";

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}

async function run(request: Request): Promise<Response> {
  try {
    const deps = createDefaultDeps();
    return await handleM10Cron(request, {
      ...deps,
      invokeTenant: (locationId) => postTenant(request, locationId, deps.cronSecret),
    });
  } catch (error) {
    log("error", "m10.misconfigured", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "misconfigured" }, 500);
  }
}

async function postTenant(
  request: Request,
  locationId: string,
  secret: string | null,
): Promise<M10Summary> {
  const url = new URL(request.url);
  url.pathname = "/api/cron/m10-tenant";
  url.searchParams.set("locationId", locationId);
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: secret ? `Bearer ${secret}` : "" },
  });
  if (!response.ok) throw new Error("tenant cron failed");
  const body = (await response.json()) as Partial<M10Summary>;
  return {
    tenants: body.tenants ?? 0,
    contacts: body.contacts ?? 0,
    written: body.written ?? 0,
    skippedUnchanged: body.skippedUnchanged ?? 0,
    skippedInProgress: body.skippedInProgress ?? 0,
    skippedNoOrders: body.skippedNoOrders ?? 0,
    skippedLock: body.skippedLock ?? 0,
    enrolled: body.enrolled ?? 0,
    errors: body.errors ?? 0,
  };
}
