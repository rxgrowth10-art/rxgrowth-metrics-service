import { describe, expect, it } from "vitest";
import { GET } from "../../api/health";

describe("GET /api/health", () => {
  it("reports the service without reading secrets", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "rxgrowth-metrics-service" });
  });
});
