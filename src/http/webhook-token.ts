import { createHash, timingSafeEqual } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Used when the location has no hash so the compare still runs. */
const DUMMY_WEBHOOK_HASH = "a3f1c8e04b6d2a9e7c5f0b1d8e4a6c2f9b7d5e3a1c8f6b4d2e0a9c7f5b3d1e8a";

export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Query param `t` from the webhook URL. The value is not logged by this helper. */
export function readWebhookToken(request: Request): string | null {
  let token: string | null;
  try {
    token = new URL(request.url).searchParams.get("t");
  } catch {
    return null;
  }
  if (!token || !token.trim()) return null;
  return token;
}

export function webhookTokenMatches(presented: string | null, expectedHash: string | null): boolean {
  const normalized = expectedHash?.trim().toLowerCase() ?? "";
  const hash = SHA256_HEX.test(normalized) ? normalized : DUMMY_WEBHOOK_HASH;
  if (!presented) return false;
  const actual = Buffer.from(hashWebhookToken(presented), "hex");
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(actual, expected);
}
