/*
 * Integration tests for the checkout functions (PR 3): the real Netlify
 * handlers against the real local database. Payfast itself is not called at
 * checkout (the browser posts the signed form), so nothing is mocked here.
 *
 * Requires the local stack (npm run db:start). Run with: npm run test:db
 */
import test from "node:test";
import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import checkout, { config as checkoutConfig } from "../netlify/functions/checkout.mts";
import orderStatus, { config as statusConfig } from "../netlify/functions/order-status.mts";
import expireOrders, { config as expireConfig } from "../netlify/functions/expire-orders.mts";
import { signature } from "../netlify/lib/payfast.mts";

function stack(): { url: string; service: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return { url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  return { url: s.API_URL, service: s.SERVICE_ROLE_KEY };
}
const DB = stack();
const SITE = "http://localhost:8080";
const PASS = "test-passphrase-" + randomBytes(4).toString("hex");
const ENV = {
  SUPABASE_URL: DB.url, SUPABASE_SERVICE_ROLE_KEY: DB.service, SITE_URL: SITE,
  PAYFAST_MODE: "sandbox", PAYFAST_MERCHANT_ID: "10000001", PAYFAST_MERCHANT_KEY: "fakekey00000a", PAYFAST_PASSPHRASE: PASS,
};
Object.assign(process.env, ENV);

const RUN = randomBytes(3).toString("hex").toUpperCase();
const email = (tag: string) => `${tag}-${RUN.toLowerCase()}-${randomBytes(3).toString("hex")}@example.com`;

async function admin(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${DB.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const ordersFor = (addr: string) => admin(`orders?select=*&email=eq.${encodeURIComponent(addr)}`);

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return checkout(new Request(`${SITE}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}
const cart = (ids: string[], extra: Record<string, unknown> = {}) => ({ items: ids.map((id) => ({ id, qty: 1 })), termsAccepted: true, ...extra });
async function body(res: Response): Promise<any> { return JSON.parse(await res.text()); }
async function makeCoupon(fields: Record<string, unknown>): Promise<string> {
  const code = `T${RUN}${randomBytes(3).toString("hex").toUpperCase()}`;
  await admin("coupons", { method: "POST", body: JSON.stringify({ code, ...fields }) });
  return code;
}

test("happy path: pending order stored with a server-priced snapshot and signed Payfast fields", async () => {
  const addr = email("happy");
  const res = await post(cart(["signature-course"], { email: addr, expectedTotal: 199700 }));
  assert.strictEqual(res.status, 201, await res.clone().text());
  assert.strictEqual(res.headers.get("cache-control"), "no-store");
  const b = await body(res);
  assert.match(b.reference, /^CBW-[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.match(b.accessKey, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(b.totalMinor, 199700);
  assert.strictEqual(b.payment.action, "https://sandbox.payfast.co.za/eng/process");

  const f = Object.fromEntries(b.payment.fields) as Record<string, string>;
  assert.strictEqual(f.amount, "1997.00");
  assert.strictEqual(f.m_payment_id, b.reference);
  assert.strictEqual(f.email_address, addr);
  assert.strictEqual(f.notify_url, `${SITE}/api/payfast/itn`);
  const unsigned = (b.payment.fields as Array<[string, string]>).filter(([k]) => k !== "signature");
  assert.strictEqual(f.signature, signature(unsigned, PASS), "signature verifies with the server passphrase");
  assert.ok(!JSON.stringify(b).includes(PASS), "passphrase never leaves the server");

  const [order] = await ordersFor(addr);
  assert.strictEqual(order.status, "pending");
  assert.strictEqual(order.provider, "payfast");
  assert.strictEqual(order.livemode, false);
  assert.strictEqual(order.currency, "ZAR");
  assert.deepStrictEqual([order.subtotal_minor, order.discount_minor, order.total_minor], [199700, 0, 199700]);
  assert.strictEqual(order.marketing_opt_in, false, "no marketing opt-in by default (spec 4.3)");
  assert.ok(order.terms_accepted_at);
  assert.strictEqual(order.access_key_hash, "\\x" + createHash("sha256").update(b.accessKey).digest("hex"), "only the key's hash is stored");
  const items = await admin(`order_items?select=title,unit_price_minor,quantity,line_total_minor,currency&order_id=eq.${order.id}`);
  assert.deepStrictEqual(items, [{ title: "The Signature Course: Your Complete Programme", unit_price_minor: 199700, quantity: 1, line_total_minor: 199700, currency: "ZAR" }]);
});

test("spec §7 Tampering: client prices, currency and totals are ignored or rejected", async () => {
  const addr = email("tamper");
  const res = await post({ ...cart(["book-one"], { email: addr }), items: [{ id: "book-one", qty: 1, price: 1, price_minor: 1, currency: "USD" }], total: 1, amount: "0.01", currency: "USD" });
  assert.strictEqual(res.status, 201);
  const b = await body(res);
  assert.strictEqual(b.totalMinor, 24900, "the database price wins");
  assert.strictEqual(Object.fromEntries(b.payment.fields).amount, "249.00");

  const before = (await ordersFor(addr)).length;
  const lowered = await post(cart(["book-one"], { email: addr, expectedTotal: 100 }));
  assert.strictEqual(lowered.status, 409);
  assert.deepStrictEqual(await body(lowered), { error: "price_changed", total_minor: 24900 });
  assert.strictEqual((await ordersFor(addr)).length, before, "a stale or forged expected total creates no order");

  const qty = await post({ ...cart([], { email: addr }), items: [{ id: "book-one", qty: 3 }] });
  assert.strictEqual(qty.status, 400);
  assert.strictEqual((await body(qty)).error, "invalid_quantity", "single licence (ADR-0008)");
});

test("only published products can be bought", async () => {
  for (const [slug, why] of [["upcoming-course", "draft"], ["old-guide", "archived"], ["no-such-thing", "unknown"]]) {
    const res = await post(cart([slug!], { email: email("p") }));
    assert.strictEqual(res.status, 400, why);
    assert.deepStrictEqual(await body(res), { error: "unknown_product", id: slug }, why);
  }
  assert.strictEqual((await body(await post(cart(["book-one", "book-one"], { email: email("p") })))).error, "invalid_cart", "duplicate line");
  assert.strictEqual((await body(await post(cart([], { email: email("p") })))).error, "invalid_cart", "empty cart");
  assert.strictEqual((await body(await post(cart(Array.from({ length: 31 }, (_, i) => `x${i}`), { email: email("p") })))).error, "invalid_cart", "too many lines");
});

test("coupons: percent, normalisation, expiry, unknown, per-email limit", async () => {
  const addr = email("coupon");
  const first = await post(cart(["signature-course"], { email: addr, couponCode: " save10 ", expectedTotal: 179730 }));
  assert.strictEqual(first.status, 201, await first.clone().text());
  const b = await body(first);
  assert.deepStrictEqual([b.subtotalMinor, b.discountMinor, b.totalMinor], [199700, 19970, 179730]);
  const [order] = await ordersFor(addr);
  assert.strictEqual(order.coupon_code, "SAVE10");

  assert.strictEqual((await body(await post(cart(["book-one"], { email: addr, couponCode: "SAVE10" })))).error, "coupon_already_used", "SAVE10 is one per email");
  assert.strictEqual((await body(await post(cart(["book-one"], { email: addr.toUpperCase(), couponCode: "SAVE10" })))).error, "coupon_already_used", "email case does not bypass the limit");
  assert.strictEqual((await body(await post(cart(["book-one"], { email: email("c"), couponCode: "EXPIRED5" })))).error, "coupon_invalid");
  assert.strictEqual((await body(await post(cart(["book-one"], { email: email("c"), couponCode: "NOPE" })))).error, "coupon_invalid");
  const fixed = await body(await post(cart(["book-one"], { email: email("c"), couponCode: "FIXED20" })));
  assert.deepStrictEqual([fixed.discountMinor, fixed.totalMinor], [2000, 22900]);
});

test("D14: totals below Payfast's R5.00 minimum are rejected; exactly R5.00 is accepted", async () => {
  const under = await makeCoupon({ amount_off_minor: 14401, currency: "ZAR" }); // planner 149.00 → 4.99
  const exact = await makeCoupon({ amount_off_minor: 14400, currency: "ZAR" }); // planner 149.00 → 5.00
  const all = await makeCoupon({ percent_off: 100 });
  const r1 = await post(cart(["planner"], { email: email("min"), couponCode: under }));
  assert.strictEqual(r1.status, 400);
  assert.deepStrictEqual(await body(r1), { error: "below_minimum", minimum_minor: 500, total_minor: 499 });
  const r2 = await post(cart(["planner"], { email: email("min"), couponCode: exact }));
  assert.strictEqual(r2.status, 201);
  assert.strictEqual(Object.fromEntries((await body(r2)).payment.fields).amount, "5.00");
  assert.strictEqual((await body(await post(cart(["planner"], { email: email("min"), couponCode: all })))).error, "below_minimum", "a 100% coupon cannot create a R0 order");
});

test("max redemptions hold under concurrent checkouts (row lock)", async () => {
  const code = await makeCoupon({ percent_off: 10, max_redemptions: 1 });
  const results = await Promise.all(Array.from({ length: 6 }, () => post(cart(["book-two"], { email: email("race"), couponCode: code }))));
  const statuses = results.map((r) => r.status).sort();
  assert.deepStrictEqual(statuses, [201, 400, 400, 400, 400, 400], "exactly one order wins the coupon");
  const errors = await Promise.all(results.filter((r) => r.status === 400).map(body));
  assert.ok(errors.every((e) => e.error === "coupon_exhausted"));
});

test("consent: terms required; marketing stored only when ticked", async () => {
  assert.deepStrictEqual(await body(await post({ ...cart(["book-two"], { email: email("t") }), termsAccepted: false })), { error: "terms_required" });
  assert.deepStrictEqual(await body(await post(cart(["book-two"], { email: "not-an-email" }))), { error: "invalid_email" });
  const addr = email("optin");
  assert.strictEqual((await post(cart(["book-two"], { email: addr, marketingOptIn: true }))).status, 201);
  assert.strictEqual((await ordersFor(addr))[0].marketing_opt_in, true);
});

test("protocol: method, content type, size, JSON and origin are enforced", async () => {
  assert.strictEqual((await checkout(new Request(`${SITE}/api/checkout`))).status, 405);
  assert.strictEqual((await post(JSON.stringify(cart(["book-two"], { email: email("x") })), { "Content-Type": "text/plain" })).status, 415);
  assert.strictEqual((await post("{not json")).status, 400);
  assert.strictEqual((await post(JSON.stringify({ items: [], pad: "x".repeat(9000) }))).status, 413);
  const evil = await post(cart(["book-two"], { email: email("x") }), { Origin: "https://evil.example" });
  assert.strictEqual(evil.status, 403);
});

test("misconfiguration fails closed and creates no order", async () => {
  const addr = email("cfg");
  for (const [k, v] of [["PAYFAST_PASSPHRASE", ""], ["PAYFAST_MODE", "production"], ["SITE_URL", "http://shop.example.com"]] as const) {
    const saved = process.env[k];
    process.env[k] = v;
    try {
      const res = await post(cart(["book-two"], { email: addr }), { Origin: process.env.SITE_URL || SITE });
      assert.strictEqual(res.status, 503, k);
      assert.deepStrictEqual(await body(res), { error: "checkout_unavailable" }, `${k}: no detail leaks to the client`);
    } finally { process.env[k] = saved; }
  }
  process.env.PAYFAST_MODE = "live";
  try {
    assert.strictEqual((await post(cart(["book-two"], { email: addr }))).status, 503, "live mode refuses a localhost notify_url");
  } finally { process.env.PAYFAST_MODE = "sandbox"; }
  assert.strictEqual((await ordersFor(addr)).length, 0);
});

test("order status: needs the reference AND the buyer's key; no probing", async () => {
  const b = await body(await post(cart(["workbook"], { email: email("status") })));
  const get = (q: string) => orderStatus(new Request(`${SITE}/api/order-status?${q}`));
  const ok = await get(`ref=${b.reference}&k=${b.accessKey}`);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await body(ok), {
    reference: b.reference, status: "pending", totalMinor: 12900, currency: "ZAR",
    items: [{ title: "The Companion Workbook", type: "template", downloads: 0, links: 0, manual: 0 }], // nothing issued until paid (PR 4)
  });
  const otherKey = randomBytes(32).toString("base64url");
  assert.strictEqual((await get(`ref=${b.reference}&k=${otherKey}`)).status, 404, "wrong key looks like not found");
  assert.strictEqual((await get(`ref=CBW-0000000000&k=${b.accessKey}`)).status, 404);
  assert.strictEqual((await get(`ref=${b.reference}`)).status, 400);
  assert.strictEqual((await get(`ref=x';drop table orders;--&k=${b.accessKey}`)).status, 400);
  assert.strictEqual((await orderStatus(new Request(`${SITE}/api/order-status`, { method: "POST" }))).status, 405);
});

test("abandoned checkouts expire, and expired orders release their coupon", async () => {
  const code = await makeCoupon({ percent_off: 10, max_redemptions: 1 });
  const b = await body(await post(cart(["book-two"], { email: email("exp"), couponCode: code })));
  assert.strictEqual((await body(await post(cart(["book-two"], { email: email("exp2"), couponCode: code })))).error, "coupon_exhausted", "held by the pending order");
  await admin(`orders?reference=eq.${b.reference}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }) });
  const run = await expireOrders();
  assert.strictEqual(run.status, 200);
  assert.ok((await body(run)).expired >= 1);
  const status = await body(await orderStatus(new Request(`${SITE}/api/order-status?ref=${b.reference}&k=${b.accessKey}`)));
  assert.strictEqual(status.status, "expired");
  assert.strictEqual((await post(cart(["book-two"], { email: email("exp3"), couponCode: code }))).status, 201, "coupon available again");
});

test("deployment config: paths, rate limits and schedule", () => {
  assert.strictEqual(checkoutConfig.path, "/api/checkout");
  assert.ok(checkoutConfig.rateLimit.windowLimit > 0 && checkoutConfig.rateLimit.windowSize <= 180);
  assert.strictEqual(statusConfig.path, "/api/order-status");
  assert.ok(statusConfig.rateLimit.windowLimit > 0);
  assert.match(expireConfig.schedule, /^\S+ \S+ \S+ \S+ \S+$/);
});
