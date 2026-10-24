import { afterEach, describe, expect, it, vi } from "vitest";
import { contactLogRef, log, redact } from "../../src/log/logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("redacts secrets and bearer tokens", () => {
    expect(
      redact({
        contactId: "c1",
        apiKey: "pit-secret",
        api_key_encrypted: "v1:cipher",
        nested: { authorization: "Bearer pit-secret", ok: true },
        note: "Authorization: Bearer pit-secret",
      }),
    ).toEqual({
      contactId: contactLogRef("c1"),
      apiKey: "[redacted]",
      api_key_encrypted: "[redacted]",
      nested: { authorization: "[redacted]", ok: true },
      note: "Authorization: Bearer [redacted]",
    });
  });

  it("writes a single JSON line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", "webhook.accepted", { locationId: "loc", apiKey: "pit-secret" });
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as { event: string; data: { locationId: string; apiKey: string } };
    expect(parsed.event).toBe("webhook.accepted");
    expect(parsed.data.locationId).toBe("loc");
    expect(parsed.data.apiKey).toBe("[redacted]");
    expect(line).not.toContain("pit-secret");
  });

  it("hashes every contactId and never writes the raw id", () => {
    const raw = "contact1";
    const other = "contact2";
    const redacted = redact({
      contactId: raw,
      contact_id: raw,
      contactIds: [raw, other, 4],
      nested: { contactId: raw },
      locationId: "loc1",
    });
    expect(JSON.stringify(redacted)).not.toContain(raw);
    expect(JSON.stringify(redacted)).not.toContain(other);
    expect(redacted).toEqual({
      contactId: contactLogRef(raw),
      contact_id: contactLogRef(raw),
      contactIds: [contactLogRef(raw), contactLogRef(other), 4],
      nested: { contactId: contactLogRef(raw) },
      locationId: "loc1",
    });
    expect(contactLogRef(raw)).toHaveLength(12);
  });

  it("strips query strings so webhook tokens are not logged", () => {
    const token = "super-secret-webhook-token";
    const redacted = redact({
      url: `https://example.test/api/webhooks/ghl?t=${token}&locationId=loc`,
      t: token,
      note: `failed request /hook?t=${token}`,
    });
    expect(JSON.stringify(redacted)).not.toContain(token);
    expect(redacted).toMatchObject({
      url: "https://example.test/api/webhooks/ghl?[redacted]",
      t: "[redacted]",
    });
  });
});
