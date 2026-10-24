export { MemoryIdempotencyStore } from "./memory";
export type { IdempotencyStore } from "./types";
export { createUpstashIdempotency, createUpstashIdempotencyFromEnv } from "./upstash";

import { MemoryIdempotencyStore } from "./memory";
import type { IdempotencyStore } from "./types";
import { createUpstashIdempotencyFromEnv } from "./upstash";

export function createIdempotencyStore(): IdempotencyStore {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createUpstashIdempotencyFromEnv();
  }
  return new MemoryIdempotencyStore();
}
