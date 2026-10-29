/*
 * Payfast custom integration: checkout form fields and signatures (ADR-0009).
 * Pure functions, no I/O. Verified against vectors produced by Payfast's own
 * PHP reference code (tests/fixtures/payfast_signature_vectors.json).
 *
 * Docs: https://developers.payfast.co.za/docs (custom integration, steps 1–3).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type PayfastMode = "sandbox" | "live";

export interface PayfastCredentials {
  mode: PayfastMode;
  merchantId: string;
  merchantKey: string;
  passphrase: string;
}

/* Signature order is the order the attributes appear in Payfast's documentation,
 * NOT alphabetical (that is the API format). */
export const CHECKOUT_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", "fica_idnumber",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "email_confirmation", "confirmation_address", "payment_method",
] as const;

export type CheckoutField = (typeof CHECKOUT_FIELD_ORDER)[number];

export function processUrl(mode: PayfastMode): string {
  return mode === "live" ? "https://www.payfast.co.za/eng/process" : "https://sandbox.payfast.co.za/eng/process";
}

/* PHP trim(): only " \t\n\r\0\x0B", unlike String.prototype.trim. */
export function phpTrim(value: string): string {
  return value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, "");
}

/* PHP urlencode(): RFC 1738 style. Everything but [A-Za-z0-9_.-] is percent-encoded
 * with upper-case hex, and spaces become "+". encodeURIComponent leaves !'()*~ alone. */
export function phpUrlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

/* Signature exactly as Payfast's generateSignature(): non-empty fields in the given
 * order, values trimmed and urlencoded, passphrase appended, MD5 lower-case hex. */
export function signature(fields: ReadonlyArray<readonly [string, string]>, passphrase: string | null): string {
  let s = fields.filter(([, v]) => v !== "").map(([k, v]) => `${k}=${phpUrlencode(phpTrim(v))}`).join("&");
  if (passphrase !== null) s += `&passphrase=${phpUrlencode(phpTrim(passphrase))}`;
  return createHash("md5").update(s, "utf8").digest("hex");
}

/* Rands with two decimals from integer cents, without floating point. */
export function amountString(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError(`invalid amount ${minor}`);
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text); // code points, so emoji/accents are never split
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…";
}

export interface CheckoutOrder {
  reference: string;
  totalMinor: number;
  email: string;
  titles: string[];
}

export interface CheckoutForm {
  action: string;
  /* Ordered: the browser must post them in this order (signature covers the order). */
  fields: Array<[string, string]>;
}

export function buildCheckout(order: CheckoutOrder, creds: PayfastCredentials, siteUrl: string, brand: string): CheckoutForm {
  const ref = encodeURIComponent(order.reference);
  const values: Partial<Record<CheckoutField, string>> = {
    merchant_id: creds.merchantId,
    merchant_key: creds.merchantKey,
    return_url: `${siteUrl}/success.html?ref=${ref}`,
    cancel_url: `${siteUrl}/cart.html?cancelled=${ref}`,
    notify_url: `${siteUrl}/api/payfast/itn`,
    email_address: order.email,
    m_payment_id: order.reference,
    amount: amountString(order.totalMinor),
    item_name: clip(`${brand} order ${order.reference}`, 100),
    item_description: clip(order.titles.join(", "), 255),
  };
  const fields = CHECKOUT_FIELD_ORDER.filter((k) => values[k] !== undefined && values[k] !== "").map((k) => [k, values[k] as string] as [string, string]);
  fields.push(["signature", signature(fields, creds.passphrase)]);
  return { action: processUrl(creds.mode), fields };
}

/* ---------------------------------------------------------------------------
 * ITN (instant transaction notification), docs Step 4 (PR 4).
 * ------------------------------------------------------------------------- */

/* Payfast's server IPs, from the docs' "Ports and IP addresses" page (checked
 * 2026-10-29). ITNs come from these; the public hostnames resolve to inbound
 * load balancers, so a DNS-only check would reject genuine notifications. */
export const PAYFAST_ITN_CIDRS = [
  "197.97.145.144/28",
  "41.74.179.192/27",
  "102.216.36.0/28",
  "102.216.36.128/28",
  "144.126.193.139/32",
] as const;

/* The hosts Payfast's reference code resolves (pfValidIP); also trusted. */
export const PAYFAST_ITN_HOSTS = ["www.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za", "sandbox.payfast.co.za"] as const;

export function validateUrl(mode: PayfastMode): string {
  return mode === "live" ? "https://www.payfast.co.za/eng/query/validate" : "https://sandbox.payfast.co.za/eng/query/validate";
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

/* "::ffff:1.2.3.4" (IPv4-mapped IPv6) → "1.2.3.4"; anything else unchanged. */
export function normaliseIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  return v.startsWith("::ffff:") && ipv4ToInt(v.slice(7)) !== null ? v.slice(7) : v;
}

export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const addr = ipv4ToInt(normaliseIp(ip));
  if (addr === null) return false;
  return cidrs.some((cidr) => {
    const [base, bits] = cidr.split("/");
    const b = ipv4ToInt(base ?? "");
    const n = Number(bits);
    if (b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return ((addr & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

/* PHP stripslashes(): drops each backslash, keeps the escaped character, "\0" → NUL. */
export function phpStripslashes(value: string): string {
  return value.replace(/\\(.?)/gs, (_, c: string) => (c === "0" ? "\0" : c));
}

/* Ordered fields of a form body exactly as PHP's $_POST sees them. Duplicate or
 * odd keys are refused: Payfast never sends them, and PHP would merge them. */
export function parseItnBody(body: string): Array<[string, string]> | null {
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [k, v] of new URLSearchParams(body)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k) || seen.has(k)) return null;
    seen.add(k);
    pairs.push([k, v]);
  }
  return pairs;
}

/* The parameter string Payfast signs: every field before "signature", empty ones
 * included, urlencoded but not trimmed (docs Step 4.3). */
export function itnParamString(pairs: ReadonlyArray<readonly [string, string]>, strip: boolean): string {
  const out: string[] = [];
  for (const [k, v] of pairs) {
    if (k === "signature") break;
    out.push(`${k}=${phpUrlencode(strip ? phpStripslashes(v) : v)}`);
  }
  return out.join("&");
}

export interface ItnSignatureCheck {
  ok: boolean;
  /* The string to post back to /eng/query/validate (the variant that matched). */
  paramString: string;
}

/* Constant-time check of the ITN signature. Payfast's reference strips slashes
 * before hashing; the unstripped form is also accepted (both need the passphrase),
 * so a value containing a backslash verifies whichever form Payfast signed. */
export function verifyItnSignature(pairs: ReadonlyArray<readonly [string, string]>, passphrase: string): ItnSignatureCheck {
  const given = pairs.find(([k]) => k === "signature")?.[1] ?? "";
  const stripped = itnParamString(pairs, true);
  if (!/^[0-9a-f]{32}$/.test(given)) return { ok: false, paramString: stripped };
  const variants = [stripped];
  const raw = itnParamString(pairs, false);
  if (raw !== stripped) variants.push(raw);
  for (const s of variants) {
    const expected = createHash("md5").update(`${s}&passphrase=${phpUrlencode(passphrase)}`, "utf8").digest();
    if (timingSafeEqual(expected, Buffer.from(given, "hex"))) return { ok: true, paramString: s };
  }
  return { ok: false, paramString: stripped };
}

/* "448.00" → 44800 cents, exactly; anything else → null. */
export function parseAmountMinor(value: string | undefined): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value ?? "");
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
