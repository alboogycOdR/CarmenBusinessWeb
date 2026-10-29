/*
 * POST /api/checkout (PR 3, spec J2, §4.1)
 *
 * Body: { items: [{ id: "<slug>", qty: 1 }], email, couponCode?, marketingOptIn?,
 *         termsAccepted: true, expectedTotal? }
 *
 * The database prices the cart, validates the coupon, enforces the R5.00
 * minimum and stores a PENDING order (create_pending_order). This function then
 * returns signed Payfast form fields for that exact server-side amount. Nothing
 * the browser sends about prices is trusted; expectedTotal only detects a stale
 * page (409). No access is granted here: payment is confirmed by the ITN (PR 4).
 */
import { createHash, randomBytes } from "node:crypto";
import { ConfigError, loadCheckoutConfig } from "../lib/config.mts";
import { bytea, RuleError, rpc } from "../lib/db.mts";
import { HttpError, json, log, readJson } from "../lib/http.mts";
import { buildCheckout } from "../lib/payfast.mts";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* Business-rule codes from create_pending_order → HTTP status. */
const RULE_STATUS: Record<string, number> = {
  price_changed: 409,
  terms_required: 400, invalid_email: 400, invalid_request: 400, empty_cart: 400, too_many_items: 400,
  invalid_cart: 400, invalid_quantity: 400, unknown_product: 400,
  coupon_invalid: 400, coupon_exhausted: 400, coupon_already_used: 400, below_minimum: 400,
};

interface PendingOrder {
  order_id: string;
  reference: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  titles: string[];
}

function parseBody(body: Record<string, unknown>) {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) throw new HttpError(400, "invalid_cart");
  const clean = items.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !SLUG.test(o.id) || o.id.length > 80) throw new HttpError(400, "invalid_cart");
    if (!Number.isInteger(o.qty)) throw new HttpError(400, "invalid_quantity");
    return { id: o.id, qty: o.qty as number };
  });
  if (typeof body.email !== "string" || body.email.length > 254) throw new HttpError(400, "invalid_email");
  const coupon = body.couponCode ?? "";
  if (typeof coupon !== "string" || coupon.length > 32) throw new HttpError(400, "coupon_invalid");
  const expected = body.expectedTotal;
  if (expected !== undefined && expected !== null && !Number.isSafeInteger(expected)) throw new HttpError(400, "invalid_request");
  return {
    items: clean,
    email: body.email,
    couponCode: coupon,
    marketingOptIn: body.marketingOptIn === true, // spec §4.3: never opted in by default
    termsAccepted: body.termsAccepted === true,
    expectedTotal: (expected ?? null) as number | null,
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });

  let cfg;
  try {
    cfg = loadCheckoutConfig(process.env);
  } catch (e) {
    log("error", "checkout_misconfigured", { problem: e instanceof ConfigError ? e.message : "unknown" });
    return json(503, { error: "checkout_unavailable" });
  }

  // Same-origin only: another site cannot create orders through a visitor's browser.
  const origin = req.headers.get("origin");
  if (origin && origin !== cfg.siteUrl) return json(403, { error: "forbidden_origin" });

  try {
    const input = parseBody(await readJson(req, 8 * 1024));
    const accessKey = randomBytes(32).toString("base64url");
    const order = await rpc<PendingOrder>(cfg, "create_pending_order", {
      p_items: input.items,
      p_email: input.email,
      p_coupon_code: input.couponCode,
      p_marketing_opt_in: input.marketingOptIn,
      p_terms_accepted: input.termsAccepted,
      p_access_key_hash: bytea(createHash("sha256").update(accessKey).digest()),
      p_expected_total: input.expectedTotal,
      p_livemode: cfg.payfast.mode === "live",
    });
    const payment = buildCheckout(
      { reference: order.reference, totalMinor: order.total_minor, email: input.email.trim().toLowerCase(), titles: order.titles },
      cfg.payfast, cfg.siteUrl, cfg.brand,
    );
    log("info", "checkout_created", { reference: order.reference, total_minor: order.total_minor, items: input.items.length, mode: cfg.payfast.mode });
    return json(201, {
      reference: order.reference,
      accessKey, // shown to this buyer only; lets the status page read this order
      currency: order.currency,
      subtotalMinor: order.subtotal_minor,
      discountMinor: order.discount_minor,
      totalMinor: order.total_minor,
      payment,
    });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code });
    if (e instanceof RuleError) {
      const status = RULE_STATUS[e.code] ?? 400;
      return json(status, { error: e.code, ...e.detail });
    }
    log("error", "checkout_failed", { message: e instanceof Error ? e.message : String(e) });
    return json(500, { error: "checkout_failed" });
  }
}

export const config = {
  path: "/api/checkout",
  method: ["POST"],
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
