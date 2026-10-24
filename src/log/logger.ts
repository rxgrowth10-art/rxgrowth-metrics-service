export type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY = /api[_-]?key|authorization|token|secret|password|credential|cipher/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") {
    return value.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  }
  return value;
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
