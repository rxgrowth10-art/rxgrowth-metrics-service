import { describe, expect, it } from "vitest";
import { bearerMatches, headerMatches } from "../../src/http/auth";

describe("shared secrets", () => {
  it("compares bearer tokens and headers in constant time", () => {
    expect(bearerMatches("Bearer cron-secret", "cron-secret")).toBe(true);
    expect(bearerMatches("Bearer cron-secret", "other")).toBe(false);
    expect(bearerMatches("cron-secret", "cron-secret")).toBe(false);
    expect(bearerMatches(null, "cron-secret")).toBe(false);
    expect(headerMatches("hook-secret", "hook-secret")).toBe(true);
    expect(headerMatches("hook-secret", "hook-secretx")).toBe(false);
  });
});
