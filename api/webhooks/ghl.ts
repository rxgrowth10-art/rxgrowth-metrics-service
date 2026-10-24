import { json } from "../../src/http/json";
import { log } from "../../src/log/logger";
import { createDefaultDeps } from "../../src/runtime/deps";
import { handleGhlWebhook } from "../../src/webhook/handle";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleGhlWebhook(request, createDefaultDeps());
  } catch (error) {
    log("error", "webhook.misconfigured", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "misconfigured" }, 500);
  }
}
