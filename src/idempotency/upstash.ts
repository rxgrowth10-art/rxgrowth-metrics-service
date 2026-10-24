import { Redis } from "@upstash/redis";
import type { IdempotencyStore } from "./types.js";

export interface RedisSetNx {
  set(key: string, value: string, options: { nx?: true; ex: number }): Promise<string | null>;
  del(key: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
}

export function createUpstashIdempotency(redis: RedisSetNx): IdempotencyStore {
  return {
    async setNx(key, ttlSeconds) {
      const result = await redis.set(key, "1", { nx: true, ex: ttlSeconds });
      return result === "OK";
    },
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, { ex: ttlSeconds });
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

export function redisRestCredentials(
  env: NodeJS.ProcessEnv,
): { url: string; token: string } | null {
  const kvUrl = env.KV_REST_API_URL?.trim();
  const kvToken = env.KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };
  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };
  return null;
}

export function createUpstashIdempotencyFromEnv(env: NodeJS.ProcessEnv = process.env): IdempotencyStore {
  const credentials = redisRestCredentials(env);
  if (!credentials) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are not set");
  }
  return createUpstashIdempotency(
    new Redis({ url: credentials.url, token: credentials.token }) as unknown as RedisSetNx,
  );
}
