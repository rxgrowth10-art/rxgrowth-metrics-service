export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  if (!headers) return Response.json(body, { status });
  return Response.json(body, { status, headers });
}
