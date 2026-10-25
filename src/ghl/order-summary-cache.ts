import { Redis } from "@upstash/redis";
import { redisRestCredentials } from "../idempotency/upstash.js";

/**
 * Order-summary store. Reads are one MGET per chunk. Writes are one pipeline
 * of `SET key value EX ttl` (one billed command per key, one HTTP round trip).
 */
export interface OrderSummaryCache {
  mget(keys: readonly string[]): Promise<unknown[]>;
  setMany(entries: readonly { key: string; value: string }[], ttlSeconds: number): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, member: string): Promise<void>;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** In-memory stand-in for tests. `commands` counts the way Upstash bills them. */
export class MemoryOrderSummaryCache implements OrderSummaryCache {
  readonly commands: string[] = [];
  private readonly values = new Map<string, Entry>();
  private readonly sets = new Map<string, Set<string>>();

  constructor(private readonly now: () => number = Date.now) {}

  async mget(keys: readonly string[]): Promise<unknown[]> {
    this.commands.push("mget");
    return keys.map((key) => {
      const entry = this.values.get(key);
      if (!entry) return null;
      if (this.now() >= entry.expiresAt) {
        this.values.delete(key);
        return null;
      }
      return entry.value;
    });
  }

  async setMany(entries: readonly { key: string; value: string }[], ttlSeconds: number): Promise<void> {
    if (entries.length === 0) return;
    const expiresAt = this.now() + ttlSeconds * 1000;
    for (const entry of entries) {
      this.commands.push("set");
      this.values.set(entry.key, { value: entry.value, expiresAt });
    }
  }

  async sadd(key: string, member: string): Promise<void> {
    this.commands.push("sadd");
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
  }

  async smembers(key: string): Promise<string[]> {
    this.commands.push("smembers");
    return [...(this.sets.get(key) ?? [])];
  }

  async srem(key: string, member: string): Promise<void> {
    this.commands.push("srem");
    this.sets.get(key)?.delete(member);
  }

  ttlSeconds(key: string): number | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    return Math.round((entry.expiresAt - this.now()) / 1000);
  }
}

export interface OrderSummaryRedis {
  mget(...keys: string[]): Promise<unknown[]>;
  pipeline(): {
    set(key: string, value: string, options: { ex: number }): unknown;
    exec(): Promise<unknown>;
  };
  sadd(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
}

export function createUpstashOrderSummaryCache(redis: OrderSummaryRedis): OrderSummaryCache {
  return {
    async mget(keys) {
      if (keys.length === 0) return [];
      const values = await redis.mget(...keys);
      return Array.isArray(values) ? values : [];
    },
    async setMany(entries, ttlSeconds) {
      if (entries.length === 0) return;
      const pipeline = redis.pipeline();
      for (const entry of entries) pipeline.set(entry.key, entry.value, { ex: ttlSeconds });
      await pipeline.exec();
    },
    async sadd(key, member) {
      await redis.sadd(key, member);
    },
    async smembers(key) {
      const members = await redis.smembers(key);
      if (!Array.isArray(members)) return [];
      return members.filter((member): member is string => typeof member === "string");
    },
    async srem(key, member) {
      await redis.srem(key, member);
    },
  };
}

export function createRedisClient(env: NodeJS.ProcessEnv = process.env): Redis | null {
  const credentials = redisRestCredentials(env);
  if (!credentials) return null;
  return new Redis({ url: credentials.url, token: credentials.token });
}

export function createOrderSummaryCache(
  env: NodeJS.ProcessEnv = process.env,
  redis: OrderSummaryRedis | Redis | null = null,
): OrderSummaryCache {
  if (redis) return createUpstashOrderSummaryCache(redis as OrderSummaryRedis);
  const client = createRedisClient(env);
  if (!client) return new MemoryOrderSummaryCache();
  return createUpstashOrderSummaryCache(client as unknown as OrderSummaryRedis);
}
