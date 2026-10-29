/*
 * Scheduled: mark abandoned checkouts as expired (PR 3, spec §4.1).
 * Payfast sends no notification for an abandoned payment, so pending orders
 * past `expires_at` (2 hours) are expired here. A late COMPLETE ITN is still
 * honoured by the state machine (expired → paid).
 */
import { ConfigError, loadDbConfig } from "../lib/config.mts";
import { rpc } from "../lib/db.mts";
import { log } from "../lib/http.mts";

export default async function handler(): Promise<Response> {
  try {
    const cfg = loadDbConfig(process.env);
    const expired = await rpc<number>(cfg, "expire_stale_orders", {});
    log("info", "orders_expired", { count: expired });
    return new Response(JSON.stringify({ expired }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    log("error", "expire_orders_failed", { message: e instanceof ConfigError ? e.message : e instanceof Error ? e.message : String(e) });
    return new Response(null, { status: 500 });
  }
}

export const config = { schedule: "*/15 * * * *" };
