import { createHash } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY = /api[_-]?key|authorization|token|secret|password|credential|cipher|^t$/i;

/** Same 12-hex prefix on every log line. The raw contact id is never written. */
export function contactLogRef(contactId: string): string {
  return createHash("sha256").update(contactId, "utf8").digest("hex").slice(0, 12);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if ((key === "contactId" || key === "contact_id") && typeof inner === "string") {
        output[key] = contactLogRef(inner);
      } else if (key === "contactIds" && Array.isArray(inner)) {
        output[key] = inner.map((item) => (typeof item === "string" ? contactLogRef(item) : redact(item, depth + 1)));
      } else {
        output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
      }
    }
    return output;
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

function redactString(value: string): string {
  return value
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([^\s?#]*)\?[^\s#]*/g, "$1?[redacted]");
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    data: redact(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
