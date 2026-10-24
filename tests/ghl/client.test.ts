import { describe, expect, it } from "vitest";
import { createGhlClient, GHL_API_VERSION } from "../../src/ghl/client.js";
import { LocationRateLimiter, type Clock } from "../../src/ghl/rate-limit.js";

const API_KEY = "super-secret-api-key-xyz";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeClock(): Clock & { sleeps: number[] } {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe("GHL client", () => {
  it("retries a 429 and then reads the order page", async () => {
    const clock = fakeClock();
    let calls = 0;
    const urls: string[] = [];
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      baseDelayMs: 25,
      maxDelayMs: 1000,
      maxRetries: 2,
      fetchImpl: async (input, init) => {
        calls += 1;
        urls.push(String(input));
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
        expect(headers.get("version")).toBe(GHL_API_VERSION);
        if (calls === 1) return jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" });
        return jsonResponse({
          data: [
            {
              id: "o1",
              amount: 10,
              liveMode: true,
              markAsTest: false,
              paymentStatus: "unpaid",
              status: "unfulfilled",
            },
          ],
          totalCount: 1,
        });
      },
    });

    const orders = await client.listOrders("contact_1");
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: "o1",
      paymentStatus: "unpaid",
      status: "unfulfilled",
      liveMode: true,
      markAsTest: false,
    });
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([0]);
    expect(urls[0]).toContain("offset=0");
    expect(urls[0]).not.toContain("limit=500");
  });

  it("pages orders with offset until totalCount is covered", async () => {
    const clock = fakeClock();
    const urls: string[] = [];
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      pageSize: 2,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        urls.push(url.toString());
        expect(url.searchParams.get("limit")).toBe("2");
        expect(url.searchParams.get("locationId")).toBe("loc_1");
        expect(url.searchParams.get("altId")).toBe("loc_1");
        expect(url.searchParams.get("altType")).toBe("location");
        expect(url.searchParams.get("contactId")).toBe("contact_1");
        const offset = Number(url.searchParams.get("offset"));
        if (offset === 0) {
          return jsonResponse({
            data: [
              { _id: "o1", amount: 1 },
              { _id: "o2", amount: 2 },
            ],
            totalCount: 3,
          });
        }
        return jsonResponse({ data: [{ _id: "o3", amount: 3 }, { _id: "o2", amount: 2 }], totalCount: 3 });
      },
    });

    const orders = await client.listOrders("contact_1");
    expect(orders.map((order) => order.id)).toEqual(["o1", "o2", "o3"]);
    expect(urls.map((url) => new URL(url).searchParams.get("offset"))).toEqual(["0", "2"]);
    expect(urls.every((url) => !url.includes("limit=500"))).toBe(true);
  });

  it("does not retry a 400 and keeps the api key out of the error", async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ message: `ignored ${API_KEY}` }, 400);
      },
    });
    await expect(client.getContact("contact_1")).rejects.toThrow(/status 400/);
    expect(calls).toBe(1);
    await client.getContact("contact_1").catch((error: unknown) => {
      expect(String(error)).not.toContain(API_KEY);
    });
  });

  it("retries a network failure and a 500", async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      baseDelayMs: 10,
      maxRetries: 2,
      random: () => 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket hang up");
        if (calls === 2) return jsonResponse({}, 503);
        return jsonResponse({
          contact: { id: "contact_1", customFields: [{ id: "f1", value: "Eligible" }] },
        });
      },
    });
    const contact = await client.getContact("contact_1");
    expect(contact.customFields[0]?.value).toBe("Eligible");
    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual([10, 20]);
  });

  it("spaces requests for one location", async () => {
    const clock = fakeClock();
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      minIntervalMs: 50,
      rateLimiter: new LocationRateLimiter(50, clock),
      pageSize: 1,
      fetchImpl: async (input) => {
        const offset = Number(new URL(String(input)).searchParams.get("offset"));
        if (offset === 0) return jsonResponse({ data: [{ id: "o1" }], totalCount: 2 });
        return jsonResponse({ data: [{ id: "o2" }], totalCount: 2 });
      },
    });
    const orders = await client.listOrders("contact_1");
    expect(orders).toHaveLength(2);
    expect(clock.sleeps).toEqual([50]);
  });

  it("follows the contact search cursor", async () => {
    const clock = fakeClock();
    const bodies: unknown[] = [];
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      contactPageSize: 1,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { searchAfter?: unknown[]; pageLimit?: number };
        bodies.push(body);
        expect(body.pageLimit).toBe(1);
        if (!body.searchAfter) {
          return jsonResponse({
            contacts: [{ id: "c1", customFields: [] }],
            searchAfter: ["cursor-1"],
          });
        }
        return jsonResponse({ contacts: [{ id: "c2", customFields: [] }] });
      },
    });
    const contacts = await client.searchContacts();
    expect(contacts.map((contact) => contact.id)).toEqual(["c1", "c2"]);
    expect(bodies).toHaveLength(2);
  });

  it("stops when order pagination exceeds the page cap", async () => {
    const clock = fakeClock();
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      pageSize: 1,
      maxOrderPages: 1,
      fetchImpl: async () => jsonResponse({ data: [{ id: "o1" }], totalCount: 5 }),
    });
    await expect(client.listOrders("contact_1")).rejects.toThrow(/page cap/);
  });

  it("writes custom fields by id and can enroll a workflow", async () => {
    const clock = fakeClock();
    const calls: Array<{ url: string; body: unknown }> = [];
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse({ succeeded: true });
      },
    });
    await client.updateContact("contact_1", [{ id: "field_1", key: "total_orders", value: "3" }]);
    await client.addContactToWorkflow("contact_1", "wf_1");
    expect(calls[0]?.body).toEqual({
      customFields: [{ id: "field_1", key: "total_orders", field_value: "3", fieldValue: "3" }],
    });
    expect(calls[1]?.url).toContain("/contacts/contact_1/workflow/wf_1");
    expect(JSON.stringify(calls)).not.toContain(API_KEY);
  });

  it("honors Retry-After above the jitter cap and jitters synthesized backoff", async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      baseDelayMs: 100,
      maxDelayMs: 1000,
      maxRetries: 1,
      random: () => 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({}, 429, { "retry-after": "2" });
        return jsonResponse({ contact: { id: "contact_1", customFields: [] } });
      },
    });
    await client.getContact("contact_1");
    expect(clock.sleeps).toEqual([2000]);

    const jittered = fakeClock();
    let attempts = 0;
    const jitterClient = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock: jittered,
      rateLimiter: new LocationRateLimiter(0, jittered),
      baseDelayMs: 100,
      maxDelayMs: 1000,
      maxRetries: 1,
      random: () => 0,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return jsonResponse({}, 503);
        return jsonResponse({ contact: { id: "contact_1", customFields: [] } });
      },
    });
    await jitterClient.getContact("contact_1");
    expect(jittered.sleeps).toEqual([50]);
  });

  it("does not retry workflow enrollment", async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, 503);
      },
    });
    await expect(client.addContactToWorkflow("contact_1", "wf_1")).rejects.toThrow(/503/);
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("drops orders for a different contact and loads one order with altId", async () => {
    const clock = fakeClock();
    const urls: string[] = [];
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/payments/orders/order_9")) {
          return jsonResponse({
            _id: "order_9",
            contactId: "contact_1",
            amount: 93.5,
            paymentStatus: "unpaid",
            liveMode: true,
            createdAt: 1767225600000,
          });
        }
        return jsonResponse({
          data: [
            { _id: "keep", contactId: "contact_1", amount: 10, paymentStatus: "paid", liveMode: true },
            { _id: "drop", contactId: "someone_else", amount: 99, paymentStatus: "paid", liveMode: true },
          ],
          totalCount: 2,
        });
      },
    });
    const orders = await client.listOrders("contact_1");
    expect(orders.map((order) => order.id)).toEqual(["keep"]);
    const detail = await client.getOrder("order_9");
    expect(detail).toMatchObject({ id: "order_9", amount: 93.5, createdAt: "1767225600000", paymentStatus: "unpaid" });
    expect(urls.some((url) => url.includes("altType=location") && url.includes("order_9"))).toBe(true);
  });

  it("lists one location order page with altId and no contact filter", async () => {
    const clock = fakeClock();
    const urls: string[] = [];
    const client = createGhlClient({
      apiKey: API_KEY,
      locationId: "loc_1",
      clock,
      rateLimiter: new LocationRateLimiter(0, clock),
      fetchImpl: async (input) => {
        urls.push(String(input));
        return jsonResponse({
          data: [
            {
              _id: "o1",
              contactId: "c1",
              amount: 10,
              status: "cancelled",
              paymentStatus: "paid",
              liveMode: true,
              updatedAt: "2026-06-22T00:00:00.000Z",
            },
          ],
          totalCount: 40,
        });
      },
    });
    const page = await client.listLocationOrdersPage(40);
    expect(page.totalCount).toBe(40);
    expect(page.orders.map((item) => item.id)).toEqual(["o1"]);
    const url = urls[0] ?? "";
    expect(url).toContain("altType=location");
    expect(url).toContain("altId=loc_1");
    expect(url).toContain("locationId=loc_1");
    expect(url).toContain("offset=40");
    expect(url).toContain("limit=");
    expect(url).not.toContain("contactId");
  });
});
