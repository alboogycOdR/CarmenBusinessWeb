/*
 * Issue download links for a paid order (PR 5). Until the delivery email
 * (PR 6) sends them automatically, support can run this and email the links.
 * The admin "send new links" action (PR 10) calls the same database function.
 *
 *   node scripts/issue-download-links.mts <order reference> [--replace]
 *
 * --replace revokes the order's earlier links first (use when a buyer's links
 * leaked or were forwarded). Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * SITE_URL. Each link works for 7 days and 5 downloads (D5). The raw tokens
 * are printed once and never stored: run it again for new ones.
 */
import { pathToFileURL } from "node:url";
import { ConfigError, loadDbConfig, type DbConfig } from "../netlify/lib/config.mts";
import { RuleError, rpc } from "../netlify/lib/db.mts";

export interface IssuedLink { label: string; filename: string; url: string; expiresAt: string; maxDownloads: number }

interface Issued {
  reference: string;
  links: Array<{ label: string; filename: string; token: string; expires_at: string; max_downloads: number }>;
}

export function downloadUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/download?t=${token}`;
}

export async function issueDownloadLinks(cfg: DbConfig, siteUrl: string, reference: string, replace = false): Promise<{ reference: string; links: IssuedLink[] }> {
  if (!/^CBW-[0-9A-HJKMNP-TV-Z]{10}$/.test(reference)) throw new Error("not an order reference");
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/orders?reference=eq.${reference}&select=id`, {
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` },
    signal: AbortSignal.timeout(8000),
  });
  const rows = (await res.json()) as Array<{ id: string }>;
  if (!res.ok || !rows[0]) throw new Error("order not found");
  const out = await rpc<Issued>(cfg, "issue_delivery_tokens", { p_order_id: rows[0].id, p_replace: replace });
  return {
    reference: out.reference,
    links: out.links.map((l) => ({ label: l.label, filename: l.filename, url: downloadUrl(siteUrl, l.token), expiresAt: l.expires_at, maxDownloads: l.max_downloads })),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [reference = "", flag] = process.argv.slice(2);
  try {
    const cfg = loadDbConfig(process.env);
    const site = (process.env.SITE_URL ?? "").trim();
    if (!/^https?:\/\/[^\s/]+$/.test(site.replace(/\/+$/, ""))) throw new ConfigError("SITE_URL must be the shop's origin");
    const r = await issueDownloadLinks(cfg, site, reference, flag === "--replace");
    if (!r.links.length) console.log(`${r.reference}: no downloadable files in this order.`);
    for (const l of r.links) console.log(`${l.label}\n  ${l.url}\n  valid until ${l.expiresAt}, ${l.maxDownloads} downloads\n`);
  } catch (e) {
    console.error(e instanceof RuleError ? `refused: ${e.code}` : e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
