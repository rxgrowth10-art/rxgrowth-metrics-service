import { json } from "../../src/http/json.js";
import { log } from "../../src/log/logger.js";
import { createDefaultDeps } from "../../src/runtime/deps.js";
import { handleGhlWebhook, methodNotAllowed } from "../../src/webhook/handle.js";

export function GET(): Response {
  return methodNotAllowed();
}

export function PUT(): Response {
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}

export function OPTIONS(): Response {
  return methodNotAllowed();
}

export function HEAD(): Response {
  return methodNotAllowed();
}

export async function POST(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  try {
    return await handleGhlWebhook(request, createDefaultDeps());
  } catch (error) {
    log("error", "webhook.misconfigured", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "misconfigured" }, 500);
  }
}
