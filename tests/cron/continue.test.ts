import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleTenantContinuation } from "../../src/cron/continue.js";

const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn() }));

vi.mock("@vercel/functions", () => ({ waitUntil }));

describe("scheduleTenantContinuation", () => {
  afterEach(() => {
    waitUntil.mockReset();
    vi.unstubAllGlobals();
  });

  it("schedules the next tenant hop through waitUntil", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    scheduleTenantContinuation(new Request("https://example.test/api/cron/m10"), "loc_1", "cron-secret");
    expect(waitUntil).toHaveBeenCalledOnce();
    const pending = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
    await pending;
    expect(fetchMock).toHaveBeenCalledOnce();
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, { method: string; headers: { authorization: string } }]>;
    expect(String(calls[0]?.[0])).toBe("https://example.test/api/cron/m10-tenant?locationId=loc_1");
    expect(calls[0]?.[1]).toEqual({
      method: "POST",
      headers: { authorization: "Bearer cron-secret" },
    });
  });
});
