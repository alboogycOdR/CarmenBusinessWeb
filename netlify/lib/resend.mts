/* Resend adapter (PR 6, ADR-0004). One HTTP call; errors are classified so
 * the outbox knows whether a retry can ever succeed. */

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  tags: Record<string, string>;
}

export class SendError extends Error {
  readonly status: number;        // 0 = network/timeout
  readonly permanent: boolean;    // retrying the same message can never succeed
  readonly retryAfterSeconds: number | null;
  constructor(message: string, status: number, permanent: boolean, retryAfterSeconds: number | null) {
    super(message);
    this.status = status;
    this.permanent = permanent;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/* 400/422: the message itself is invalid (e.g. a malformed recipient): permanent.
 * 429 (rate limit or daily quota), 5xx, network: transient.
 * 401/403 (bad key, unverified domain): transient, because fixing the
 * configuration makes the same message succeed; attempts are capped anyway. */
export function classify(status: number): boolean {
  return status === 400 || status === 422;
}

export async function sendViaResend(apiKey: string, msg: OutgoingEmail, timeoutMs = 8000): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: msg.from,
        to: [msg.to],
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        tags: Object.entries(msg.tags).map(([name, value]) => ({ name, value })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SendError(`network: ${e instanceof Error ? e.message : String(e)}`, 0, false, null);
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
  if (res.ok && typeof body.id === "string") return { id: body.id };
  const retryAfter = Number(res.headers.get("retry-after"));
  throw new SendError(`resend ${res.status} ${body.name ?? ""}: ${body.message ?? ""}`.trim(), res.status, classify(res.status),
    Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null);
}
