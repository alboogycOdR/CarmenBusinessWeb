/*
 * Payfast ITN verification and processing (PR 4, ADR-0009, docs Step 4).
 *
 * Shared by the /api/payfast/itn function and scripts/replay-event.mts. The
 * four checks Payfast requires run here, failing closed and in order:
 *   1. signature (MD5 with the passphrase, constant-time),
 *   2. source IP: Payfast's published server ranges, or an address of the
 *      hosts its reference code resolves. Never the Referer header,
 *   3. merchant_id and the amount (the amount, exact to the cent, in SQL),
 *   4. server confirmation: /eng/query/validate must answer VALID.
 * The verdict and the delivery are then stored by process_payfast_itn(), which
 * deduplicates, checks the order and confirms payment in one transaction.
 */
import { randomUUID } from "node:crypto";
import type { ItnConfig } from "./config.mts";
import { rpc } from "./db.mts";
import { ipInCidrs, normaliseIp, PAYFAST_ITN_CIDRS, PAYFAST_ITN_HOSTS, parseAmountMinor, validateUrl, verifyItnSignature, type PayfastMode } from "./payfast.mts";

export interface ItnDeps {
  /* IPv4 addresses for a hostname. */
  resolveHost(host: string): Promise<string[]>;
  /* Body of Payfast's /eng/query/validate response; throws if Payfast is unreachable. */
  validate(mode: PayfastMode, paramString: string): Promise<string>;
}

/* Failures that may succeed on a later delivery: answering non-200 makes
 * Payfast retry ("immediately, then after 10 minutes, then exponentially longer"). */
const TRANSIENT = new Set(["source_unverified", "server_validation_unavailable"]);

export interface ItnResult {
  status: number;   // HTTP status for Payfast
  outcome: "paid" | "already_paid" | "ignored" | "duplicate" | "failed" | "rejected";
  error?: string;
  eventKey: string;
  eventId?: string;
  reference?: string | null;
  unfulfilledItems?: string[];
}

interface ProcessResult {
  outcome: "paid" | "already_paid" | "ignored" | "duplicate" | "failed";
  error?: string;
  event_id: string;
  reference?: string | null;
  unfulfilled_items?: string[];
}

export interface ItnOptions {
  /* Replay: the payload is no longer an inbound connection. The signature and
   * Payfast's own server confirmation are still required. */
  skipSourceCheck?: boolean;
}

async function sourceCheck(ip: string | null, deps: ItnDeps): Promise<string | null> {
  if (!ip) return "source_unverified";
  const addr = normaliseIp(ip);
  if (ipInCidrs(addr, PAYFAST_ITN_CIDRS)) return null;
  const results = await Promise.allSettled(PAYFAST_ITN_HOSTS.map((h) => deps.resolveHost(h)));
  if (results.some((r) => r.status === "fulfilled" && r.value.map(normaliseIp).includes(addr))) return null;
  // Every lookup failed: we cannot tell, so let Payfast retry rather than reject.
  if (results.every((r) => r.status === "rejected")) return "source_unverified";
  return "source_ip_mismatch";
}

export async function processItn(
  pairs: Array<[string, string]>,
  sourceIp: string | null,
  cfg: ItnConfig,
  deps: ItnDeps,
  opts: ItnOptions = {},
): Promise<ItnResult> {
  const f = Object.fromEntries(pairs) as Record<string, string | undefined>;
  const payload = { fields: pairs, source_ip: sourceIp, mode: cfg.mode, ...(opts.skipSourceCheck ? { replayed_at: new Date().toISOString() } : {}) };
  const livemode = cfg.mode === "live";
  const amountMinor = parseAmountMinor(f.amount_gross);
  const reference = f.m_payment_id ?? "";

  const store = (key: string, error: string | null) => rpc<ProcessResult>(cfg, "process_payfast_itn", {
    p_event_key: key, p_payment_status: f.payment_status ?? "", p_reference: reference, p_amount_minor: amountMinor,
    p_txn_id: f.pf_payment_id ?? "", p_livemode: livemode, p_payload: payload, p_check_error: error,
  });

  // 1. Signature. An unauthenticated delivery never claims a real event key. It
  //    is stored (for replay after a passphrase fix) only if it came from
  //    Payfast's servers; anything else is just logged, so strangers cannot
  //    fill the table.
  const sig = verifyItnSignature(pairs, cfg.passphrase);
  const wellFormed = /^\d{1,20}$/.test(f.pf_payment_id ?? "") && /^[A-Z_]{1,20}$/.test(f.payment_status ?? "");
  if (!sig.ok || !wellFormed) {
    const key = `rejected:${randomUUID()}`;
    const error = sig.ok ? "malformed_notification" : "signature_mismatch";
    const fromPayfast = !opts.skipSourceCheck && (await sourceCheck(sourceIp, deps)) === null;
    const r = fromPayfast ? await store(key, error) : null;
    return { status: 400, outcome: "rejected", error, eventKey: key, ...(r ? { eventId: r.event_id } : {}) };
  }
  const key = `${f.pf_payment_id}:${f.payment_status}`;

  // 2–4, in Payfast's order; the first failure is recorded and stops the rest.
  let error: string | null = opts.skipSourceCheck ? null : await sourceCheck(sourceIp, deps);
  if (!error && f.merchant_id !== cfg.merchantId) error = "merchant_mismatch";
  if (!error) {
    try {
      const answer = (await deps.validate(cfg.mode, sig.paramString)).trim();
      if (answer !== "VALID") error = "server_validation_invalid";
    } catch {
      error = "server_validation_unavailable";
    }
  }

  const r = await store(key, error);
  const base = { eventKey: key, eventId: r.event_id, reference: r.reference ?? null };
  if (r.outcome === "failed") {
    const status = r.error === "source_ip_mismatch" ? 403 : TRANSIENT.has(r.error ?? "") ? 503 : 200;
    return { ...base, status, outcome: "failed", error: r.error ?? "unknown" };
  }
  return { ...base, status: 200, outcome: r.outcome, ...(r.unfulfilled_items?.length ? { unfulfilledItems: r.unfulfilled_items } : {}) };
}

/* Production dependencies: DNS (cached briefly) and Payfast's validate endpoint. */
export function defaultDeps(): ItnDeps {
  const cache = new Map<string, { at: number; ips: string[] }>();
  return {
    async resolveHost(host) {
      const hit = cache.get(host);
      if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ips;
      const { Resolver } = await import("node:dns/promises");
      // Netlify ends a synchronous function after 10 s: DNS (2 s) + validate (6 s) + DB stay inside it.
      const resolver = new Resolver({ timeout: 2000, tries: 1 });
      const ips = await resolver.resolve4(host);
      cache.set(host, { at: Date.now(), ips });
      return ips;
    },
    async validate(mode, paramString) {
      const res = await fetch(validateUrl(mode), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: paramString,
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) throw new Error(`validate HTTP ${res.status}`);
      return res.text();
    },
  };
}
