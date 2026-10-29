/*
 * Scheduled: send queued transactional emails (PR 6, ADR-0004).
 * Runs every 2 minutes; the ITN function also sends a paid order's email
 * straight away when it has time, so this is the safety net and the retry
 * engine (exponential backoff, 10 attempts, then an admin alert).
 * Without RESEND_API_KEY/EMAIL_FROM nothing is sent and emails stay queued.
 */
import { ConfigError, loadEmailConfig } from "../lib/config.mts";
import { log } from "../lib/http.mts";
import { resendDeps, runOutbox } from "../lib/outbox.mts";

export default async function handler(): Promise<Response> {
  try {
    const cfg = loadEmailConfig(process.env);
    const results = await runOutbox(cfg, resendDeps(cfg));
    for (const r of results.filter((x) => x.outcome !== "sent")) {
      log(r.outcome === "failed" ? "error" : "warn", "email_" + r.outcome, { email_id: r.id, template: r.template, error: r.error });
    }
    log("info", "outbox_run", { sent: results.filter((r) => r.outcome === "sent").length, retry: results.filter((r) => r.outcome === "retry").length, failed: results.filter((r) => r.outcome === "failed").length });
    return new Response(null, { status: 200 });
  } catch (e) {
    log("error", "outbox_failed", { message: e instanceof ConfigError ? e.message : e instanceof Error ? e.message : String(e) });
    return new Response(null, { status: 500 });
  }
}

export const config = { schedule: "*/2 * * * *" };
