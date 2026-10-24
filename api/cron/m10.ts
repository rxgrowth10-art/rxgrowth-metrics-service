import { handleM10Cron } from "../../src/cron/m10.js";
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
    return await handleM10Cron(request, createDefaultDeps());
  } catch (error) {
    log("error", "m10.misconfigured", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "misconfigured" }, 500);
  }
}
