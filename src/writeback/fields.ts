import type { GhlContact } from "../ghl";

export function buildFieldIdMap(fields: readonly { id: string; fieldKey: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of fields) {
    const key = field.fieldKey.startsWith("contact.") ? field.fieldKey.slice("contact.".length) : field.fieldKey;
    map.set(key, field.id);
  }
  return map;
}

export function requireFieldId(map: ReadonlyMap<string, string>, key: string): string {
  const id = map.get(key);
  if (!id) throw new Error(`Missing custom field contact.${key} for this location`);
  return id;
}

export function readContactField(
  contact: GhlContact,
  key: string,
  ids: ReadonlyMap<string, string>,
): string | null {
  const id = ids.get(key);
  for (const field of contact.customFields) {
    const fieldKey = field.key?.replace(/^contact\./, "");
    if ((id && field.id === id) || fieldKey === key) {
      const value = field.value?.trim();
      return value ? value : null;
    }
  }
  return null;
}
