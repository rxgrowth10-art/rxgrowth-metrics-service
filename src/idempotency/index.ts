export { MemoryIdempotencyStore } from "./memory";
export type { IdempotencyStore } from "./types";
export { createUpstashIdempotency, createUpstashIdempotencyFromEnv } from "./upstash";

import { MemoryIdempotencyStore } from "./memory";
import type { IdempotencyStore } from "./types";
import { createUpstashIdempotencyFromEnv, redisRestCredentials } from "./upstash";

export function createIdempotencyStore(env: NodeJS.ProcessEnv = process.env): IdempotencyStore {
  if (redisRestCredentials(env)) return createUpstashIdempotencyFromEnv(env);
  if (env.VERCEL_ENV === "production") {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required when VERCEL_ENV=production");
  }
  return new MemoryIdempotencyStore();
}
