import { createHash, timingSafeEqual } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;

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
  if (!presented || !expectedHash) return false;
  const normalized = expectedHash.trim().toLowerCase();
  if (!SHA256_HEX.test(normalized)) return false;
  const actual = Buffer.from(hashWebhookToken(presented), "hex");
  const expected = Buffer.from(normalized, "hex");
  return timingSafeEqual(actual, expected);
}
