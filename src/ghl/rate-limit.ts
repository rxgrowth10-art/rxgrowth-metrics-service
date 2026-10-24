export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class LocationRateLimiter {
  private readonly nextAt = new Map<string, number>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock,
  ) {}

  async wait(locationId: string): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = this.clock.now();
    const earliest = this.nextAt.get(locationId) ?? now;
    const start = Math.max(now, earliest);
    this.nextAt.set(locationId, start + this.minIntervalMs);
    const delay = start - now;
    if (delay > 0) await this.clock.sleep(delay);
  }
}

const sharedLimiters = new Map<string, LocationRateLimiter>();

export function sharedLimiter(locationId: string, minIntervalMs: number, clock: Clock): LocationRateLimiter {
  const key = `${locationId}:${minIntervalMs}`;
  const existing = sharedLimiters.get(key);
  if (existing) return existing;
  const created = new LocationRateLimiter(minIntervalMs, clock);
  sharedLimiters.set(key, created);
  return created;
}

export function resetSharedLimiters(): void {
  sharedLimiters.clear();
}
