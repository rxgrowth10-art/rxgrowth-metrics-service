import { GhlRequestError } from "./errors.js";
import { parseContact, parseContactPage, parseCustomFields, parseOrderPage, parseOrderResource } from "./parse.js";
import { type Clock, LocationRateLimiter, sharedLimiter, systemClock } from "./rate-limit.js";
import type { CustomFieldWrite, GhlClient, GhlContact, GhlContactPage, GhlCustomField, GhlOrder, GhlOrderPage } from "./types.js";

export const GHL_API_VERSION = "2021-07-28";
export const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
export const ORDER_PAGE_SIZE = 100;
export const CONTACT_PAGE_SIZE = 100;

export interface GhlClientOptions {
  apiKey: string;
  locationId: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 0..1 source for retry jitter. Tests pass a constant. */
  random?: () => number;
  minIntervalMs?: number;
  pageSize?: number;
  contactPageSize?: number;
  maxOrderPages?: number;
  maxContactPages?: number;
  clock?: Clock;
  rateLimiter?: LocationRateLimiter;
}

export function createGhlClient(options: GhlClientOptions): GhlClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GHL_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 4000;
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 20_000;
  const random = options.random ?? Math.random;
  const pageSize = options.pageSize ?? ORDER_PAGE_SIZE;
  const contactPageSize = options.contactPageSize ?? CONTACT_PAGE_SIZE;
  const maxOrderPages = options.maxOrderPages ?? 100;
  const maxContactPages = options.maxContactPages ?? 200;
  const clock = options.clock ?? systemClock;
  const minIntervalMs = options.minIntervalMs ?? 100;
  const limiter =
    options.rateLimiter ?? sharedLimiter(options.locationId, minIntervalMs, clock);
  const locationId = options.locationId;
  const apiKey = options.apiKey;

  async function requestJson(
    method: string,
    path: string,
    init: { query?: Record<string, string | number>; body?: unknown; retry?: boolean } = {},
  ): Promise<unknown> {
    const url = buildUrl(baseUrl, path, init.query);
    const retries = init.retry === false ? 0 : maxRetries;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await limiter.wait(locationId);
      const timed = timeoutSignal(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            Version: GHL_API_VERSION,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: timed.signal,
        });
      } catch {
        timed.cancel();
        if (attempt === retries) {
          throw new GhlRequestError("GHL request failed", 0, path);
        }
        await clock.sleep(backoff(attempt, baseDelayMs, maxDelayMs, random));
        continue;
      }
      timed.cancel();

      const text = await response.text();
      if (response.ok) {
        if (!text) return {};
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new GhlRequestError("GHL response was not JSON", response.status, path);
        }
      }
      if (isRetryable(response.status) && attempt < retries) {
        await clock.sleep(retryDelay(response, attempt, clock, baseDelayMs, maxDelayMs, random));
        continue;
      }
      throw new GhlRequestError(`GHL request failed with status ${response.status}`, response.status, path);
    }
    throw new GhlRequestError("GHL request failed", 0, path);
  }

  async function searchContactsPage(searchAfter: readonly unknown[] | null): Promise<GhlContactPage> {
    const body: Record<string, unknown> = {
      locationId,
      pageLimit: contactPageSize,
      sort: [{ field: "dateAdded", direction: "asc" }],
    };
    if (searchAfter && searchAfter.length > 0) body.searchAfter = [...searchAfter];
    const response = await requestJson("POST", "/contacts/search", { body });
    const parsed = parseContactPage(response);
    return { contacts: parsed.contacts, searchAfter: parsed.searchAfter };
  }

  async function searchContacts(): Promise<GhlContact[]> {
    const contacts: GhlContact[] = [];
    let searchAfter: unknown[] | null = null;
    for (let page = 0; page < maxContactPages; page += 1) {
      const parsed = await searchContactsPage(searchAfter);
      contacts.push(...parsed.contacts);
      if (parsed.contacts.length < contactPageSize) return contacts;
      if (!parsed.searchAfter || parsed.searchAfter.length === 0) return contacts;
      if (searchAfter && JSON.stringify(searchAfter) === JSON.stringify(parsed.searchAfter)) {
        return contacts;
      }
      searchAfter = parsed.searchAfter;
    }
    throw new GhlRequestError("Contact pagination exceeded the page cap", 0, "/contacts/search");
  }

  return {
    async listOrders(contactId: string): Promise<GhlOrder[]> {
      const orders: GhlOrder[] = [];
      const seen = new Set<string>();
      let offset = 0;
      let totalCount: number | null = null;
      let reachedEnd = false;
      for (let page = 0; page < maxOrderPages; page += 1) {
        const body = await requestJson("GET", "/payments/orders", {
          query: {
            locationId,
            altId: locationId,
            altType: "location",
            contactId,
            limit: pageSize,
            offset,
          },
        });
        const parsed = parseOrderPage(body);
        if (parsed.totalCount !== null) totalCount = parsed.totalCount;
        for (const order of parsed.orders) {
          if (order.id) {
            if (seen.has(order.id)) continue;
            seen.add(order.id);
          }
          orders.push(order);
        }
        if (parsed.orders.length === 0) {
          reachedEnd = true;
          break;
        }
        offset += parsed.orders.length;
        if (totalCount !== null && offset >= totalCount) {
          reachedEnd = true;
          break;
        }
        if (totalCount === null && parsed.orders.length < pageSize) {
          reachedEnd = true;
          break;
        }
      }
      if (!reachedEnd) {
        throw new GhlRequestError("Order pagination exceeded the page cap", 0, "/payments/orders");
      }
      return orders.filter((order) => order.contactId === null || order.contactId === contactId);
    },

    async listLocationOrdersPage(offset: number): Promise<GhlOrderPage> {
      const body = await requestJson("GET", "/payments/orders", {
        query: {
          locationId,
          altId: locationId,
          altType: "location",
          limit: ORDER_PAGE_SIZE,
          offset,
        },
      });
      const parsed = parseOrderPage(body);
      return { orders: parsed.orders, totalCount: parsed.totalCount };
    },

    async getOrder(orderId: string): Promise<GhlOrder | null> {
      const body = await requestJson("GET", `/payments/orders/${encodeURIComponent(orderId)}`, {
        query: { altId: locationId, altType: "location", locationId },
      });
      return parseOrderResource(body);
    },

    async getContact(contactId: string): Promise<GhlContact> {
      const body = await requestJson("GET", `/contacts/${encodeURIComponent(contactId)}`);
      const contact = parseContact(body);
      if (!contact) throw new GhlRequestError("GHL contact response was empty", 200, "/contacts/{contactId}");
      return contact;
    },

    async listCustomFields(): Promise<GhlCustomField[]> {
      const body = await requestJson(
        "GET",
        `/locations/${encodeURIComponent(locationId)}/customFields`,
        { query: { model: "contact" } },
      );
      return parseCustomFields(body);
    },

    async updateContact(contactId: string, fields: readonly CustomFieldWrite[]): Promise<void> {
      await requestJson("PUT", `/contacts/${encodeURIComponent(contactId)}`, {
        body: {
          customFields: fields.map((field) => ({
            id: field.id,
            key: field.key,
            field_value: field.value,
            fieldValue: field.value,
          })),
        },
      });
    },

    searchContactsPage,
    searchContacts,

    async addContactToWorkflow(contactId: string, workflowId: string, eventStartTime?: string): Promise<void> {
      await requestJson(
        "POST",
        `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`,
        { body: eventStartTime ? { eventStartTime } : {}, retry: false },
      );
    },
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number>): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

const RETRY_AFTER_CAP_MS = 60_000;

function backoff(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const unit = Math.min(1, Math.max(0, random()));
  return Math.round(exponential * (0.5 + unit * 0.5));
}

function retryDelay(
  response: Response,
  attempt: number,
  clock: Clock,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(RETRY_AFTER_CAP_MS, Math.round(seconds * 1000));
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, date - clock.now()));
  }
  return backoff(attempt, baseDelayMs, maxDelayMs, random);
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer.unref === "function") timer.unref();
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}
