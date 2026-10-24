/** Location and contact ids: 1–64 letters or digits, matching GoHighLevel id shape. */
export const ALPHANUMERIC_ID = /^[A-Za-z0-9]{1,64}$/;

export function assertAlphanumericId(value: string, label: string): string {
  if (!ALPHANUMERIC_ID.test(value)) {
    throw new Error(`${label} must be 1-64 alphanumeric characters`);
  }
  return value;
}
