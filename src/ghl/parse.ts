import type { GhlContact, GhlContactField, GhlCustomField, GhlOrder } from "./types";

export interface ParsedOrderPage {
  orders: GhlOrder[];
  totalCount: number | null;
}

export interface ParsedContactPage {
  contacts: GhlContact[];
  searchAfter: unknown[] | null;
}

export function parseOrderPage(body: unknown): ParsedOrderPage {
  const list = extractList(body, ["data", "orders"]);
  const totalCount = readTotalCount(body);
  return {
    orders: list.map(parseOrder).filter((order): order is GhlOrder => order !== null),
    totalCount,
  };
}

export function parseContact(body: unknown): GhlContact | null {
  const source = unwrapContact(body);
  if (!source) return null;
  const id = asString(source.id);
  if (!id) return null;
  const customFields = Array.isArray(source.customFields)
    ? source.customFields.map(parseContactField).filter((field): field is GhlContactField => field !== null)
    : [];
  return { id, customFields };
}

export function parseContactPage(body: unknown): ParsedContactPage {
  const list = extractList(body, ["contacts", "data"]);
  const contacts = list
    .map((item) => parseContact(item))
    .filter((contact): contact is GhlContact => contact !== null);
  return { contacts, searchAfter: readSearchAfter(body) };
}

export function parseCustomFields(body: unknown): GhlCustomField[] {
  const list = extractList(body, ["customFields", "fields"]);
  const fields: GhlCustomField[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = asString(record.id);
    const fieldKey = asString(record.fieldKey);
    if (!id || !fieldKey) continue;
    fields.push({
      id,
      fieldKey,
      name: asString(record.name) ?? "",
      dataType: asString(record.dataType) ?? "",
    });
  }
  return fields;
}

export function parseOrderResource(body: unknown): GhlOrder | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.order && typeof record.order === "object") return parseOrder(record.order);
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) return parseOrder(record.data);
  return parseOrder(body);
}

function parseOrder(value: unknown): GhlOrder | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    id: asString(record.id) ?? asString(record._id),
    contactId: asString(record.contactId),
    status: asString(record.status),
    paymentStatus: asString(record.paymentStatus),
    fulfillmentStatus: asString(record.fulfillmentStatus),
    liveMode: typeof record.liveMode === "boolean" ? record.liveMode : null,
    markAsTest: typeof record.markAsTest === "boolean" ? record.markAsTest : null,
    amount: typeof record.amount === "number" || typeof record.amount === "string" ? record.amount : null,
    sourceName: asString(record.sourceName),
    sourceSubType: asString(record.sourceSubType),
    createdAt: asTimestamp(record.createdAt),
    updatedAt: asTimestamp(record.updatedAt),
    currency: asString(record.currency),
  };
}

function parseContactField(value: unknown): GhlContactField | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const rawValue = record.value ?? record.fieldValue ?? record.field_value;
  return {
    id: asString(record.id),
    key: asString(record.fieldKey) ?? asString(record.key),
    value: asFieldValue(rawValue),
  };
}

function unwrapContact(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.contact && typeof record.contact === "object") {
    return record.contact as Record<string, unknown>;
  }
  if (typeof record.id === "string") return record;
  return null;
}

function extractList(body: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function readTotalCount(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const total = (body as Record<string, unknown>).totalCount;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function readSearchAfter(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.searchAfter)) return record.searchAfter;
  const meta = record.meta;
  if (meta && typeof meta === "object" && Array.isArray((meta as Record<string, unknown>).searchAfter)) {
    return (meta as Record<string, unknown>).searchAfter as unknown[];
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function asFieldValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}
