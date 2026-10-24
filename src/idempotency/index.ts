export { MemoryIdempotencyStore } from "./memory";
export type { IdempotencyStore } from "./types";
export { createUpstashIdempotency, createUpstashIdempotencyFromEnv } from "./upstash";

import { MemoryIdempotencyStore } from "./memory";
import type { IdempotencyStore } from "./types";
import { createUpstashIdempotencyFromEnv } from "./upstash";

export function createIdempotencyStore(env: NodeJS.ProcessEnv = process.env): IdempotencyStore {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return createUpstashIdempotencyFromEnv();
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when VERCEL_ENV=production");
  }
  return new MemoryIdempotencyStore();
}
