/*
 * Outbox worker (PR 6, ADR-0004): sends queued transactional emails.
 *
 * Each run leases due rows (claim_due_emails, FOR UPDATE SKIP LOCKED), so runs
 * that overlap never send the same email. For the delivery email, download
 * links are issued at send time: the raw tokens exist only in that email. A
 * retry issues fresh links and never revokes the earlier ones, so if a send
 * that "failed" had in fact been delivered, the buyer's first email still
 * works (the worst case is a duplicate email, never a dead link).
 */
import type { EmailConfig } from "./config.mts";
import { rpc } from "./db.mts";
import { renderAdminAlert, renderManualAccessReady, renderOrderPaid, type Brand, type DownloadLink, type EmailContext, type RenderedEmail } from "./email-templates.mts";
import { SendError, sendViaResend, type OutgoingEmail } from "./resend.mts";

export interface OutboxDeps {
  send(msg: OutgoingEmail): Promise<{ id: string }>;
}

export const resendDeps = (cfg: EmailConfig): OutboxDeps => ({ send: (m) => sendViaResend(cfg.resendApiKey, m) });

interface Claimed { id: string; template: string; to_email: string; order_id: string | null; dedupe_key: string; attempts: number }
interface Issued { links: Array<{ fulfilment_id: string; token: string; expires_at: string; max_downloads: number }> }

export interface SendResult { id: string; template: string; outcome: "sent" | "retry" | "failed"; error?: string }

export const downloadUrl = (siteUrl: string, token: string) => `${siteUrl}/api/download?t=${token}`;

export async function renderEmail(cfg: EmailConfig, ctx: EmailContext): Promise<RenderedEmail> {
  const brand: Brand = { name: cfg.brand, siteUrl: cfg.siteUrl, replyTo: cfg.replyTo, vatNumber: cfg.vatNumber };
  switch (ctx.email.template) {
    case "order_paid": {
      const links = new Map<string, DownloadLink>();
      const hasFiles = ctx.items.some((i) => i.deliveries.some((d) => d.kind === "file" && d.status !== "revoked" && d.status !== "failed"));
      if (hasFiles) {
        // Throws delivery:order_not_paid if the order was refunded/disputed meanwhile.
        const issued = await rpc<Issued>(cfg, "issue_delivery_tokens", { p_order_id: ctx.order!.id, p_replace: false });
        for (const l of issued.links) links.set(l.fulfilment_id, { url: downloadUrl(cfg.siteUrl, l.token), expiresAt: l.expires_at, maxDownloads: l.max_downloads });
      }
      return renderOrderPaid(ctx, links, brand);
    }
    case "manual_access_ready":
      return renderManualAccessReady(ctx, brand);
    case "admin_alert":
      return renderAdminAlert(ctx, brand);
    default:
      throw new SendError(`no template for ${ctx.email.template}`, 0, true, null);
  }
}

async function sendOne(cfg: EmailConfig, deps: OutboxDeps, e: Claimed): Promise<SendResult> {
  const fail = async (error: string, permanent: boolean, retryAfter: number | null): Promise<SendResult> => {
    const r = await rpc<{ outcome: string }>(cfg, "fail_email", {
      p_email_id: e.id, p_error: error, p_permanent: permanent, p_alert_to: cfg.alertTo, p_retry_after_seconds: retryAfter,
    });
    return { id: e.id, template: e.template, outcome: r.outcome === "failed" ? "failed" : "retry", error };
  };
  let rendered: RenderedEmail;
  try {
    const ctx = await rpc<EmailContext>(cfg, "email_context", { p_email_id: e.id });
    if (e.template === "order_paid" && (!ctx.order || !["paid", "partially_refunded"].includes(ctx.order.status))) {
      return await fail(`order is ${ctx.order?.status ?? "missing"}; delivery email not sent`, true, null);
    }
    rendered = await renderEmail(cfg, ctx);
  } catch (err) {
    const permanent = err instanceof SendError ? err.permanent : /order_not_paid/.test(String((err as Error)?.message ?? err));
    return fail(`prepare: ${err instanceof Error ? err.message : String(err)}`, permanent, null);
  }
  try {
    const sent = await deps.send({
      from: cfg.from, to: e.to_email, replyTo: cfg.replyTo, ...rendered,
      tags: { template: e.template.replace(/[^A-Za-z0-9_-]/g, "_") },
    });
    await rpc(cfg, "complete_email", { p_email_id: e.id, p_provider_message_id: sent.id });
    return { id: e.id, template: e.template, outcome: "sent" };
  } catch (err) {
    if (err instanceof SendError) return fail(err.message, err.permanent, err.retryAfterSeconds);
    return fail(`send: ${err instanceof Error ? err.message : String(err)}`, false, null);
  }
}

/* Send what is due. Sequential: well under Resend's 10 requests/second. */
export async function runOutbox(cfg: EmailConfig, deps: OutboxDeps, opts: { limit?: number; orderId?: string; reference?: string } = {}): Promise<SendResult[]> {
  const claimed = await rpc<Claimed[]>(cfg, "claim_due_emails", { p_limit: opts.limit ?? 20, p_order_id: opts.orderId ?? null, p_reference: opts.reference ?? null });
  const results: SendResult[] = [];
  for (const e of claimed) results.push(await sendOne(cfg, deps, e));
  return results;
}
