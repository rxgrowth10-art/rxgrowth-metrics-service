import { Redis } from "@upstash/redis";
import type { IdempotencyStore } from "./types";

export interface RedisSetNx {
  set(key: string, value: string, options: { nx: true; ex: number }): Promise<string | null>;
  del(key: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
}

export function createUpstashIdempotency(redis: RedisSetNx): IdempotencyStore {
  return {
    async setNx(key, ttlSeconds) {
      const result = await redis.set(key, "1", { nx: true, ex: ttlSeconds });
      return result === "OK";
    },
    async del(key) {
      await redis.del(key);
    },
    async get(key) {
      const value = await redis.get(key);
      if (value === null || value === undefined) return null;
      return typeof value === "string" ? value : JSON.stringify(value);
    },
  };
}

export function createUpstashIdempotencyFromEnv(): IdempotencyStore {
  return createUpstashIdempotency(Redis.fromEnv() as unknown as RedisSetNx);
}
