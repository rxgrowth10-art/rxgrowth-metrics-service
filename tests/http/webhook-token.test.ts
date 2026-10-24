import { describe, expect, it } from "vitest";
import { hashWebhookToken, readWebhookToken, webhookTokenMatches } from "../../src/http/webhook-token";

describe("webhook query token", () => {
  it("matches a sha256 hash in constant time and ignores a missing token", () => {
    const token = "tenant-token-value";
    const hash = hashWebhookToken(token);
    expect(hash).toHaveLength(64);
    expect(webhookTokenMatches(token, hash)).toBe(true);
    expect(webhookTokenMatches(token, hash.toUpperCase())).toBe(true);
    expect(webhookTokenMatches("other-token", hash)).toBe(false);
    expect(webhookTokenMatches(null, hash)).toBe(false);
    expect(webhookTokenMatches(token, null)).toBe(false);
    expect(webhookTokenMatches(token, "not-a-hash")).toBe(false);
    const request = new Request(`https://example.test/api/webhooks/ghl?t=${encodeURIComponent(token)}`);
    expect(readWebhookToken(request)).toBe(token);
    expect(readWebhookToken(new Request("https://example.test/api/webhooks/ghl"))).toBeNull();
  });
});
