import { createHash } from "node:crypto";
import { M06_HASH_EXCLUDED_KEYS } from "../schema/fields.js";

const EXCLUDED = new Set<string>(M06_HASH_EXCLUDED_KEYS);

export function metricsHash(values: Readonly<Record<string, string>>): string {
  const keys = Object.keys(values)
    .filter((key) => !EXCLUDED.has(key))
    .sort();
  const canonical = JSON.stringify(keys.map((key) => [key, values[key] ?? ""]));
  return createHash("sha256").update(canonical).digest("hex");
}
