import { handleM10Tenant } from "../../src/cron/m10.js";
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
    return await handleM10Tenant(request, {
      ...deps,
      scheduleContinuation: (locationId) => scheduleTenant(request, locationId, deps.cronSecret),
    });
  } catch (error) {
    log("error", "m10.misconfigured", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "misconfigured" }, 500);
  }
}

function scheduleTenant(request: Request, locationId: string, secret: string | null): void {
  const url = new URL(request.url);
  url.pathname = "/api/cron/m10-tenant";
  url.searchParams.set("locationId", locationId);
  const work = fetch(url, {
    method: "POST",
    headers: { authorization: secret ? `Bearer ${secret}` : "" },
  });
  const waitUntil = (globalThis as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil;
  if (typeof waitUntil === "function") waitUntil(work);
  else void work;
}
