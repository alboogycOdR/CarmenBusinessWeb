/*
 * Confirm hand-granted access (PR 6, J5) until the admin screens arrive (PR 10).
 *
 *   node scripts/grant-manual-access.mts <order reference>                 list what is waiting
 *   node scripts/grant-manual-access.mts <order reference> --grant <id>    mark one as granted
 *
 * Granting marks the delivery done and queues the "your access is ready"
 * email (sent by the outbox worker). Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { pathToFileURL } from "node:url";
import { loadDbConfig, type DbConfig } from "../netlify/lib/config.mts";
import { RuleError, rpc } from "../netlify/lib/db.mts";

export interface Waiting { id: string; label: string; title: string; eta: string | null; status: string }

async function rest<T>(cfg: DbConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function manualAccessFor(cfg: DbConfig, reference: string): Promise<Waiting[]> {
  if (!/^CBW-[0-9A-HJKMNP-TV-Z]{10}$/.test(reference)) throw new Error("not an order reference");
  const rows = await rest<Array<{ id: string; status: string; product_assets: { label: string; access_mode: string; manual_eta_text: string | null }; order_items: { title: string } }>>(cfg,
    `fulfilments?select=id,status,product_assets!inner(label,access_mode,manual_eta_text),order_items!inner(title),orders!inner(reference)&orders.reference=eq.${reference}&product_assets.access_mode=eq.manual`);
  return rows.map((r) => ({ id: r.id, label: r.product_assets.label, title: r.order_items.title, eta: r.product_assets.manual_eta_text, status: r.status }));
}

export async function grantManualAccess(cfg: DbConfig, fulfilmentId: string): Promise<{ outcome: string; reference: string; label: string }> {
  if (!/^[0-9a-f-]{36}$/.test(fulfilmentId)) throw new Error("not a fulfilment id");
  return rpc(cfg, "grant_manual_access", { p_fulfilment_id: fulfilmentId });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [reference = "", flag, id] = process.argv.slice(2);
  try {
    const cfg = loadDbConfig(process.env);
    if (flag === "--grant") {
      const r = await grantManualAccess(cfg, id ?? "");
      console.log(r.outcome === "granted" ? `Granted: ${r.label} (${r.reference}). The buyer's "access is ready" email is queued.` : `Already granted: ${r.label} (${r.reference}).`);
    } else {
      const list = await manualAccessFor(cfg, reference);
      if (!list.length) console.log(`${reference}: nothing in this order needs manual access.`);
      for (const w of list) console.log(`${w.status === "delivered" ? "done   " : "WAITING"}  ${w.id}  ${w.title}: ${w.label} (promised ${w.eta ?? "-"})`);
    }
  } catch (e) {
    console.error(e instanceof RuleError ? `refused: ${e.code}` : e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
