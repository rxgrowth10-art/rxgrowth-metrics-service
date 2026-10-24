import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Stand-in so an unknown location still runs the constant-time compare. Fresh per process. */
const DUMMY_WEBHOOK_HASH = randomBytes(32).toString("hex");

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
