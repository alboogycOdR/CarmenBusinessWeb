/*
 * Payfast custom integration: checkout form fields and signatures (ADR-0009).
 * Pure functions, no I/O. Verified against vectors produced by Payfast's own
 * PHP reference code (tests/fixtures/payfast_signature_vectors.json).
 *
 * Docs: https://developers.payfast.co.za/docs (custom integration, steps 1–3).
 */
import { createHash } from "node:crypto";

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
