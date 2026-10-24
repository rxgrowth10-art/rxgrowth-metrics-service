import type { IdempotencyStore } from "./types";

interface Entry {
  value: string;
  expiresAt: number;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  async setNx(key: string, ttlSeconds: number): Promise<boolean> {
    this.purge(key);
    if (this.entries.has(key)) return false;
    this.entries.set(key, { value: "1", expiresAt: this.now() + ttlSeconds * 1000 });
    return true;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.purge(key);
    return this.entries.get(key)?.value ?? null;
  }

  private purge(key: string): void {
    const entry = this.entries.get(key);
    if (entry && this.now() >= entry.expiresAt) this.entries.delete(key);
  }
}
