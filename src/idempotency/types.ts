export interface IdempotencyStore {
  setNx(key: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
}
