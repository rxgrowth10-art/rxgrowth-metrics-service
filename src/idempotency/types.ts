export interface IdempotencyStore {
  setNx(key: string, ttlSeconds: number): Promise<boolean>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
}
