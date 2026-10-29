/*
 * /api/download?t=<token>  (PR 5, spec §4.2, §7 "Download security", ADR-0005)
 *
 * GET  shows a small page: the file, downloads left, the expiry date and a
 *      Download button. It changes nothing, so email link scanners (which open
 *      every link in a message) cannot use up a buyer's downloads.
 * POST (the button) counts one download atomically and answers 303 with a
 *      60-second signed URL for the private file.
 *
 * The token is 32 random bytes; only its SHA-256 is stored. A token works only
 * for a paid order, until it expires (7 days) or is used 5 times (D5), and
 * never after revocation. Denials are plain pages that say how to get help.
 */
import { createHash } from "node:crypto";
import { ConfigError, loadDbConfig, type DbConfig } from "../lib/config.mts";
import { bytea, rpc } from "../lib/db.mts";
import { log, SECURITY_HEADERS } from "../lib/http.mts";
import { signedDownloadUrl } from "../lib/storage.mts";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface TokenStatus {
  state: "ok" | "unknown" | "unpaid" | "revoked" | "expired" | "used_up";
  label?: string;
  filename?: string;
  storage_path?: string;
  remaining?: number;
  max_downloads?: number;
  expires_at?: string;
  reference?: string;
  consumed?: boolean;
}

/* form-action must also allow the storage origin: browsers apply it to the
 * redirect that follows the Download button's POST. */
function pageHeaders(env: Record<string, string | undefined>): Record<string, string> {
  let storage = "";
  try { storage = new URL(env.SUPABASE_URL ?? "").origin; } catch { /* misconfigured: page still renders */ }
  return {
    ...SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${storage ? " " + storage : ""}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(status: number, title: string, body: string, env: Record<string, string | undefined>): Response {
  const brand = esc((env.STORE_NAME ?? "").trim() || "Carmen");
  const site = (env.SITE_URL ?? "").replace(/\/+$/, "");
  const help = site ? `<a href="${esc(site)}/contact.html">contact us</a>` : "contact us";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${brand}</title><style>
body{font:17px/1.6 Roboto,system-ui,sans-serif;color:#1f1f1f;background:#fff;margin:0}main{max-width:34rem;margin:12vh auto;padding:0 20px;text-align:center}
h1{font:500 1.9rem/1.25 Lora,Georgia,serif;margin:0 0 .6em}.muted{color:#666;font-size:.92em}
button{font:15px Roboto,system-ui,sans-serif;background:#e50069;color:#fff;border:0;border-radius:4px;padding:12px 34px;cursor:pointer}
button:focus-visible{outline:3px solid #1f1f1f;outline-offset:2px}a{color:#e50069}
@media (prefers-color-scheme:dark){body{background:#121212;color:#f4f4f4}.muted{color:#b0b0b0}}</style></head>
<body><main><p class="muted">${brand}</p><h1>${esc(title)}</h1>${body.replaceAll("{{HELP}}", help)}</main></body></html>`;
  return new Response(html, { status, headers: pageHeaders(env) });
}

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }) : "");

function denial(s: TokenStatus, env: Record<string, string | undefined>): Response {
  switch (s.state) {
    case "expired":
      return page(410, "This download link has expired", `<p>It stopped working on ${esc(day(s.expires_at))}. Please {{HELP}} with your order reference${s.reference ? ` (<strong>${esc(s.reference)}</strong>)` : ""} and we'll send you a fresh link.</p>`, env);
    case "used_up":
      return page(410, "This link has been used up", `<p>It has been used the maximum ${s.max_downloads ?? 5} times. Need it again? Please {{HELP}}${s.reference ? ` with your order reference (<strong>${esc(s.reference)}</strong>)` : ""}.</p>`, env);
    case "revoked":
      return page(410, "This link is no longer active", `<p>If you were sent a newer link, please use that one. Otherwise, {{HELP}} and we'll help.</p>`, env);
    case "unpaid":
      return page(403, "This order can't be downloaded", `<p>We couldn't find a completed payment for this order. If you've paid, please {{HELP}} with your order reference${s.reference ? ` (<strong>${esc(s.reference)}</strong>)` : ""}.</p>`, env);
    default:
      return page(404, "This download link isn't valid", `<p>Please check that you opened the whole link from your email. Still stuck? Please {{HELP}}.</p>`, env);
  }
}

async function readToken(req: Request): Promise<string> {
  if (req.method === "GET") return new URL(req.url).searchParams.get("t") ?? "";
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return "";
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > 1024) return "";
  return new URLSearchParams(raw.toString("utf8")).get("t") ?? "";
}

export const tokenHash = (token: string) => createHash("sha256").update(Buffer.from(token, "base64url")).digest();

export function createDownloadHandler(env: Record<string, string | undefined> = process.env) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method !== "GET" && req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST", ...SECURITY_HEADERS } });
    let cfg: DbConfig;
    try {
      cfg = loadDbConfig(env);
    } catch (e) {
      log("error", "download_misconfigured", { problem: e instanceof ConfigError ? e.message : "unknown" });
      return page(503, "Downloads are temporarily unavailable", `<p>Please try again in a few minutes. If it keeps happening, {{HELP}}.</p>`, env);
    }

    const token = await readToken(req);
    if (!TOKEN.test(token)) return denial({ state: "unknown" }, env);
    const hash = bytea(tokenHash(token));

    try {
      const status = await rpc<TokenStatus>(cfg, "download_token_status", { p_token_hash: hash });
      if (status.state !== "ok") {
        log("info", "download_denied", { state: status.state, reference: status.reference ?? null });
        return denial(status, env);
      }

      if (req.method === "GET") {
        const left = status.remaining ?? 0;
        return page(200, status.label ?? "Your download", `<p>${esc(status.filename ?? "")}</p>
<form method="post" action=""><input type="hidden" name="t" value="${esc(token)}"><button type="submit">Download</button></form>
<p class="muted">${left} of ${status.max_downloads ?? 5} downloads left · link valid until ${esc(day(status.expires_at))}</p>
<p class="muted">Order ${esc(status.reference ?? "")} · Problems? {{HELP}}.</p>`, env);
      }

      // Sign first: if storage fails, the buyer has not lost a download.
      const url = await signedDownloadUrl(cfg, status.storage_path ?? "", status.filename ?? "download");
      const used = await rpc<TokenStatus>(cfg, "consume_download", { p_token_hash: hash });
      if (used.state !== "ok" || !used.consumed) {
        log("info", "download_denied", { state: used.state, reference: used.reference ?? null, race: true });
        return denial(used, env);
      }
      log("info", "download_served", { reference: used.reference ?? null, remaining: used.remaining });
      return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, Location: url } });
    } catch (e) {
      log("error", "download_failed", { message: e instanceof Error ? e.message : String(e) });
      return page(503, "Downloads are temporarily unavailable", `<p>Nothing was used up. Please try again in a few minutes. If it keeps happening, {{HELP}}.</p>`, env);
    }
  };
}

export default createDownloadHandler();

export const config = {
  path: "/api/download",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
