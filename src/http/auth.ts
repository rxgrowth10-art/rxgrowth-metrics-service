import { timingSafeEqual } from "node:crypto";

export function bearerMatches(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  return safeEqual(authorization.slice(prefix.length), secret);
}

export function headerMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  return safeEqual(header, secret);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
