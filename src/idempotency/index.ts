export { MemoryIdempotencyStore } from "./memory.js";
export type { IdempotencyStore } from "./types.js";
export { createUpstashIdempotency, createUpstashIdempotencyFromEnv } from "./upstash.js";

import { MemoryIdempotencyStore } from "./memory.js";
import type { IdempotencyStore } from "./types.js";
import { createUpstashIdempotencyFromEnv, redisRestCredentials } from "./upstash.js";

export function createIdempotencyStore(env: NodeJS.ProcessEnv = process.env): IdempotencyStore {
  if (redisRestCredentials(env)) return createUpstashIdempotencyFromEnv(env);
  if (env.VERCEL_ENV === "production") {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required when VERCEL_ENV=production");
  }
  return new MemoryIdempotencyStore();
}
