const BRANCH_KEYS = ["location", "locationName", "store", "storeName", "branch", "branchName"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A display name is a non-blank string, or the `name` of an object when that
 * is a non-blank string. Empty and whitespace-only values are ignored.
 */
function readDisplayName(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const record = asRecord(value);
  if (!record || typeof record.name !== "string") return null;
  const trimmed = record.name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFirstName(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const key of BRANCH_KEYS) {
    const name = readDisplayName(record[key]);
    if (name) return name;
  }
  return null;
}

/** Branch on `delivery`, then the same names on the order itself. */
export function readBranchName(order: unknown): string | null {
  const record = asRecord(order);
  if (!record) return null;
  return readFirstName(asRecord(record.delivery)) ?? readFirstName(record);
}

/**
 * Source name already stored as `sourceName` is kept unchanged, including
 * surrounding whitespace, so a customer with no branch keeps today's value.
 * `source.name` is used only when that flat field is missing.
 */
export function readSourceName(order: unknown): string | null {
  const record = asRecord(order);
  if (!record) return null;
  if (typeof record.sourceName === "string" && record.sourceName.length > 0) return record.sourceName;
  const source = asRecord(record.source);
  if (!source) return null;
  return readDisplayName(source.name);
}

/** Branch name when the order has one, otherwise the order's source name. */
export function resolveLastOrderLocation(order: unknown): string | null {
  return readBranchName(order) ?? readSourceName(order);
}
