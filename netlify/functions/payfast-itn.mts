/*
 * POST /api/payfast/itn  (PR 4, spec §4.1/§4.2, ADR-0009)
 *
 * Payfast's instant transaction notification: the ONLY way an order becomes
 * paid. Verification and processing live in netlify/lib/itn.mts; this file is
 * the HTTP edge. Payfast re-sends a notification until it gets a 200, so:
 *   200: handled (paid, duplicate, ignored) or a permanent failure that a
 *        person must look at (stored as a failed event; see the replay tool);
 *   503: a transient failure (Payfast's validate endpoint or DNS unreachable,
 *        database down): stored where possible, and Payfast's retry recovers it;
 *   400/403: a delivery that is not a genuine Payfast notification.
 * Responses carry no detail beyond a short code.
 */
import { ConfigError, loadEmailConfig, loadItnConfig } from "../lib/config.mts";
import { defaultDeps, processItn, type ItnDeps } from "../lib/itn.mts";
import { log, SECURITY_HEADERS } from "../lib/http.mts";
import { resendDeps, runOutbox, type OutboxDeps } from "../lib/outbox.mts";
import { parseItnBody } from "../lib/payfast.mts";

const MAX_BODY = 16 * 1024;
/* Netlify ends a synchronous function after 10 s. The delivery email is sent
 * inline only if the payment was confirmed within this budget; otherwise (or
 * on any email problem) the scheduled worker sends it within 2 minutes. */
const EMAIL_KICK_BEFORE_MS = 4000;
const EMAIL_KICK_TIMEOUT_MS = 3500;

/* Netlify's context; only the connecting IP is used (never X-Forwarded-For or Referer). */
interface Context { ip?: string }

function reply(status: number, code: string): Response {
  return new Response(code, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
}

/* Best effort: never affects the answer to Payfast. */
async function kickOutbox(env: Record<string, string | undefined>, emailDeps: OutboxDeps | undefined, reference: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cfg = loadEmailConfig(env);
    const run = runOutbox(cfg, emailDeps ?? resendDeps(cfg), { limit: 3, reference });
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), EMAIL_KICK_TIMEOUT_MS); });
    const results = await Promise.race([run, timeout]);
    if (results) log("info", "itn_email_kick", { sent: results.filter((r) => r.outcome === "sent").length, other: results.filter((r) => r.outcome !== "sent").length });
  } catch (e) {
    log("warn", "itn_email_kick_skipped", { reason: e instanceof ConfigError ? "email not configured" : e instanceof Error ? e.message : String(e) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createItnHandler(deps: ItnDeps = defaultDeps(), env: Record<string, string | undefined> = process.env, emailDeps?: OutboxDeps) {
  return async function handler(req: Request, context: Context = {}): Promise<Response> {
    const started = Date.now();
    if (req.method !== "POST") return new Response("method_not_allowed", { status: 405, headers: { Allow: "POST", ...SECURITY_HEADERS } });

    let cfg;
    try {
      cfg = loadItnConfig(env);
    } catch (e) {
      // Not 200: Payfast keeps retrying until the configuration is fixed.
      log("error", "itn_misconfigured", { problem: e instanceof ConfigError ? e.message : "unknown" });
      return reply(503, "unavailable");
    }

    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return reply(415, "unsupported_media_type");
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return reply(413, "payload_too_large");
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length > MAX_BODY) return reply(413, "payload_too_large");
    const pairs = parseItnBody(raw.toString("utf8"));
    if (!pairs || pairs.length === 0) return reply(400, "invalid_request");

    const ip = context.ip ?? req.headers.get("x-nf-client-connection-ip");
    try {
      const r = await processItn(pairs, ip, cfg, deps);
      const level = r.outcome === "failed" || r.outcome === "rejected" ? "warn" : r.unfulfilledItems ? "warn" : "info";
      // Logs carry identifiers only: never the payload, email or signature.
      log(level, "itn_" + r.outcome, {
        reference: r.reference ?? null, event_key: r.eventKey, event_id: r.eventId, error: r.error, source_ip: ip, mode: cfg.mode,
        ...(r.unfulfilledItems ? { unfulfilled_items: r.unfulfilledItems.length } : {}),
      });
      if (r.outcome === "paid" && r.reference && Date.now() - started < EMAIL_KICK_BEFORE_MS) await kickOutbox(env, emailDeps, r.reference);
      return reply(r.status, r.outcome === "failed" || r.outcome === "rejected" ? r.error ?? "failed" : "OK");
    } catch (e) {
      log("error", "itn_processing_failed", { message: e instanceof Error ? e.message : String(e), source_ip: ip });
      return reply(500, "unavailable");
    }
  };
}

export default createItnHandler();

export const config = {
  path: "/api/payfast/itn",
  method: ["POST"],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
