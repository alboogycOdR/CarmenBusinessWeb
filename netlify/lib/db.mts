/* Minimal PostgREST RPC client using the service role (server only).
 * Dependency-free: business logic lives in SQL functions (ADR-0003). */
import type { DbConfig } from "./config.mts";

/* A business-rule rejection raised by a SQL function as '<area>:<code>'
 * (checkout:... from create_pending_order, delivery:... from issue_delivery_tokens). */
export class RuleError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(code: string, detail: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/* PostgREST takes bytea as a "\x<hex>" string. */
export function bytea(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}

export async function rpc<T>(cfg: DbConfig, fn: string, args: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (res.ok) return body as T;

  const err = (body ?? {}) as { code?: string; message?: string; details?: string };
  const rule = err.code === "P0001" && typeof err.message === "string" ? /^(?:checkout|delivery):(.+)$/.exec(err.message) : null;
  if (rule) {
    let detail: Record<string, unknown> = {};
    try { detail = err.details ? JSON.parse(err.details) : {}; } catch { /* keep empty */ }
    throw new RuleError(rule[1]!, detail);
  }
  throw new Error(`rpc ${fn} failed: HTTP ${res.status} ${err.code ?? ""} ${err.message ?? text.slice(0, 200)}`);
}
