import { describe, expect, it } from "vitest";
import { MemoryIdempotencyStore, createUpstashIdempotency } from "../../src/idempotency";
import type { RedisSetNx } from "../../src/idempotency/upstash";

describe("memory idempotency", () => {
  it("sets once until the ttl expires", async () => {
    let now = 0;
    const store = new MemoryIdempotencyStore(() => now);
    expect(await store.setNx("evt:loc:contact:1", 300)).toBe(true);
    expect(await store.setNx("evt:loc:contact:1", 300)).toBe(false);
    expect(await store.get("evt:loc:contact:1")).toBe("1");
    now = 299_999;
    expect(await store.setNx("evt:loc:contact:1", 300)).toBe(false);
    now = 300_000;
    expect(await store.get("evt:loc:contact:1")).toBeNull();
    expect(await store.setNx("evt:loc:contact:1", 300)).toBe(true);
  });

  it("deletes a key so a failed attempt can be retried", async () => {
    const store = new MemoryIdempotencyStore(() => 0);
    await store.setNx("lock:loc:contact", 30);
    await store.del("lock:loc:contact");
    expect(await store.setNx("lock:loc:contact", 30)).toBe(true);
  });

  it("overwrites a key with set", async () => {
    const store = new MemoryIdempotencyStore(() => 0);
    await store.set("rerun:loc:contact", "1", 60);
    await store.set("rerun:loc:contact", "2", 60);
    expect(await store.get("rerun:loc:contact")).toBe("2");
  });
});

describe("upstash idempotency", () => {
  it("treats SET NX OK as the first claim", async () => {
    const keys = new Map<string, string>();
    const redis: RedisSetNx = {
      async set(key, value, options) {
        if (options.nx && keys.has(key)) return null;
        keys.set(key, value);
        return "OK";
      },
      async del(key) {
        keys.delete(key);
        return 1;
      },
      async get(key) {
        return keys.get(key) ?? null;
      },
    };
    const store = createUpstashIdempotency(redis);
    expect(await store.setNx("m10:loc:2026-10-24", 172800)).toBe(true);
    expect(await store.setNx("m10:loc:2026-10-24", 172800)).toBe(false);
    expect(await store.get("m10:loc:2026-10-24")).toBe("1");
    await store.del("m10:loc:2026-10-24");
    expect(await store.get("m10:loc:2026-10-24")).toBeNull();
    await store.set("rerun:loc:contact", "1", 60);
    expect(await store.get("rerun:loc:contact")).toBe("1");
  });
});

describe("idempotency selection", () => {
  it("fails closed in production when Upstash is not configured", async () => {
    const { createIdempotencyStore } = await import("../../src/idempotency");
    expect(() => createIdempotencyStore({ VERCEL_ENV: "production" })).toThrow(/UPSTASH_REDIS/);
    const store = createIdempotencyStore({ VERCEL_ENV: "development" });
    expect(await store.setNx("evt:test", 10)).toBe(true);
  });
});
