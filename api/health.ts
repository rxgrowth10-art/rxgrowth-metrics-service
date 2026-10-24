import { json } from "../src/http/json.js";

export async function GET(): Promise<Response> {
  return json({ ok: true, service: "rxgrowth-metrics-service" });
}
