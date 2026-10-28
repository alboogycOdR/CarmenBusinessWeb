"use strict";
/*
 * Stripe Checkout for the static storefront. Dependency-free (uses fetch).
 *
 * The browser only sends product ids, quantities and a discount code. Prices are
 * ALWAYS taken from assets/js/site-config.js on the server, so a visitor cannot
 * change what they pay by editing the page.
 *
 * Environment variables (Netlify > Site settings > Environment):
 *   STRIPE_SECRET_KEY  sk_live_... or sk_test_...
 *   SITE_URL           https://your-domain.com (no trailing slash)
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MAX_QTY = 99;
const MAX_ITEMS = 30;

function loadCatalog() {
  const file = path.join(__dirname, "..", "..", "assets", "js", "site-config.js");
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), ctx);
  return ctx.window.SITE;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* Validate the request and price it. Returns amounts in cents. */
function buildOrder(site, body) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, "Your cart is empty.");
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, "Too many items.");
  const seen = new Set();
  const items = body.items.map((it) => {
    const product = site.products.find((p) => p.id === (it && it.id));
    const qty = Number.parseInt(it && it.qty, 10);
    if (!product) throw new HttpError(400, "Unknown product.");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new HttpError(400, "Invalid quantity.");
    if (seen.has(product.id)) throw new HttpError(400, "Duplicate product.");
    seen.add(product.id);
    return { name: product.title, unit: Math.round(product.price * 100), qty };
  });
  const key = String(body.code || "").trim().toUpperCase();
  const rules = (site.checkout && site.checkout.discounts) || {};
  if (key && !Object.prototype.hasOwnProperty.call(rules, key)) throw new HttpError(400, "That discount code is not valid.");
  return { items, percent: key ? rules[key].percent : 0, code: key, currency: String(site.brand.currency || "USD").toLowerCase() };
}

function sessionForm(order, siteUrl, couponId) {
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("success_url", siteUrl + "/success.html");
  f.set("cancel_url", siteUrl + "/cart.html");
  f.set("billing_address_collection", "auto");
  order.items.forEach((it, i) => {
    f.set(`line_items[${i}][quantity]`, String(it.qty));
    f.set(`line_items[${i}][price_data][currency]`, order.currency);
    f.set(`line_items[${i}][price_data][unit_amount]`, String(it.unit));
    f.set(`line_items[${i}][price_data][product_data][name]`, it.name);
  });
  if (couponId) f.set("discounts[0][coupon]", couponId);
  return f;
}

async function stripe(secret, endpoint, form) {
  const res = await fetch("https://api.stripe.com/v1/" + endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, (json.error && json.error.message) || "Payment provider error.");
  return json;
}

async function createCheckout(site, body, env) {
  const order = buildOrder(site, body);
  const secret = env.STRIPE_SECRET_KEY;
  const siteUrl = String(env.SITE_URL || "").replace(/\/+$/, "");
  if (!secret || !/^https?:\/\//.test(siteUrl)) throw new HttpError(500, "Checkout is not configured.");
  let couponId;
  if (order.percent) {
    const c = await stripe(secret, "coupons", new URLSearchParams({ percent_off: String(order.percent), duration: "once", max_redemptions: "1", name: order.code }));
    couponId = c.id;
  }
  const session = await stripe(secret, "checkout/sessions", sessionForm(order, siteUrl, couponId));
  return { url: session.url };
}

exports.handler = async function (event) {
  const json = (status, obj) => ({ statusCode: status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { throw new HttpError(400, "Invalid request."); }
    return json(200, await createCheckout(loadCatalog(), body, process.env));
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error("checkout failed", e);
    return json(500, { error: "Something went wrong." });
  }
};

exports._test = { buildOrder, sessionForm, createCheckout, loadCatalog, HttpError };
