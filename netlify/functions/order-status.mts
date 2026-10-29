/*
 * GET /api/order-status?ref=<reference>&k=<access key>  (PR 3, spec §4.1)
 *
 * Lets the buyer's success page show the server's view of their order. The
 * access key is returned only to the browser that created the order; without
 * it every lookup looks like "not found", so references cannot be probed.
 * The page says "paid" only when this endpoint does (spec: never from a redirect).
 * PR 4: also lists the items and what is being delivered for each (counts of
 * downloads, instant links and manually granted access), never the links themselves.
 */
import { createHash } from "node:crypto";
import { ConfigError, loadDbConfig } from "../lib/config.mts";
import { bytea, rpc } from "../lib/db.mts";
import { json, log } from "../lib/http.mts";

const REF = /^CBW-[0-9A-HJKMNP-TV-Z]{10}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

interface OrderStatus {
  reference: string;
  status: string;
  total_minor: number;
  currency: string;
  items?: Array<{ title: string; type: string; downloads: number; links: number; manual: number }>;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
  let cfg;
  try {
    cfg = loadDbConfig(process.env);
  } catch (e) {
    log("error", "order_status_misconfigured", { problem: e instanceof ConfigError ? e.message : "unknown" });
    return json(503, { error: "unavailable" });
  }
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") ?? "";
  const key = url.searchParams.get("k") ?? "";
  if (!REF.test(ref) || !KEY.test(key)) return json(400, { error: "invalid_request" });

  try {
    const order = await rpc<OrderStatus | null>(
      cfg, "get_order_status", { p_reference: ref, p_access_key_hash: bytea(createHash("sha256").update(key).digest()) });
    if (!order) return json(404, { error: "not_found" });
    return json(200, {
      reference: order.reference, status: order.status, totalMinor: order.total_minor, currency: order.currency,
      items: (order.items ?? []).map((i) => ({ title: i.title, type: i.type, downloads: i.downloads, links: i.links, manual: i.manual })),
    });
  } catch (e) {
    log("error", "order_status_failed", { message: e instanceof Error ? e.message : String(e) });
    return json(500, { error: "unavailable" });
  }
}

export const config = {
  path: "/api/order-status",
  method: ["GET"],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
