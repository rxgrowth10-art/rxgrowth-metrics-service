import { waitUntil } from "@vercel/functions";

export function scheduleTenantContinuation(request: Request, locationId: string, secret: string | null): void {
  const url = new URL(request.url);
  url.pathname = "/api/cron/m10-tenant";
  url.searchParams.set("locationId", locationId);
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: { authorization: secret ? `Bearer ${secret}` : "" },
    }),
  );
}
