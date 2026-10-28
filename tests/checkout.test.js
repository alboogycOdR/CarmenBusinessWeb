"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { handler, _test } = require("../netlify/functions/checkout.js");
const { buildOrder, sessionForm, loadCatalog } = _test;

const site = loadCatalog();
const first = site.products[0];
const ENV = { STRIPE_SECRET_KEY: "sk_test_123", SITE_URL: "https://shop.example.com/" };

function mockStripe(responses) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, form: new URLSearchParams(opts.body) });
    const r = responses.shift();
    return { ok: r.ok !== false, json: async () => r.body };
  };
  return calls;
}
const post = (body, method = "POST") => handler({ httpMethod: method, body: typeof body === "string" ? body : JSON.stringify(body) });
const withEnv = async (fn) => {
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  try { return await fn(); } finally { process.env = saved; }
};

test("prices come from the server catalogue, never the request", () => {
  const o = buildOrder(site, { items: [{ id: first.id, qty: 2, price: 0.01 }] });
  assert.deepStrictEqual(o.items, [{ name: first.title, unit: Math.round(first.price * 100), qty: 2 }]);
});

test("rejects bad input", () => {
  const bad = [
    null, {}, { items: [] }, { items: [{ id: "ghost", qty: 1 }] },
    { items: [{ id: first.id, qty: 0 }] }, { items: [{ id: first.id, qty: 100 }] }, { items: [{ id: first.id, qty: "x" }] },
    { items: [{ id: first.id, qty: 1 }, { id: first.id, qty: 1 }] },
    { items: [{ id: first.id, qty: 1 }], code: "BOGUS" }, { items: [{ id: first.id, qty: 1 }], code: "__proto__" },
    { items: Array.from({ length: 31 }, () => ({ id: first.id, qty: 1 })) },
  ];
  for (const b of bad) assert.throws(() => buildOrder(site, b), (e) => e.status === 400, JSON.stringify(b));
});

test("session form maps line items, URLs and coupon", () => {
  const o = buildOrder(site, { items: [{ id: first.id, qty: 3 }], code: "save10" });
  assert.strictEqual(o.percent, 10);
  const f = sessionForm(o, "https://shop.example.com", "co_1");
  assert.strictEqual(f.get("mode"), "payment");
  assert.strictEqual(f.get("success_url"), "https://shop.example.com/success.html");
  assert.strictEqual(f.get("cancel_url"), "https://shop.example.com/cart.html");
  assert.strictEqual(f.get("line_items[0][quantity]"), "3");
  assert.strictEqual(f.get("line_items[0][price_data][unit_amount]"), String(Math.round(first.price * 100)));
  assert.strictEqual(f.get("line_items[0][price_data][currency]"), "usd");
  assert.strictEqual(f.get("discounts[0][coupon]"), "co_1");
});

test("happy path without a code: one Stripe call, returns the URL", () => withEnv(async () => {
  const calls = mockStripe([{ body: { url: "https://checkout.stripe.com/c/pay_1" } }]);
  const res = await post({ items: [{ id: first.id, qty: 1 }] });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res.body), { url: "https://checkout.stripe.com/c/pay_1" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.strictEqual(calls[0].opts.headers.Authorization, "Bearer sk_test_123");
  assert.strictEqual(calls[0].form.get("success_url"), "https://shop.example.com/success.html");
}));

test("discount code creates a single-use coupon first", () => withEnv(async () => {
  const calls = mockStripe([{ body: { id: "co_9" } }, { body: { url: "https://checkout.stripe.com/c/pay_2" } }]);
  const res = await post({ items: [{ id: first.id, qty: 1 }], code: "SAVE10" });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls[0].url, "https://api.stripe.com/v1/coupons");
  assert.strictEqual(calls[0].form.get("percent_off"), "10");
  assert.strictEqual(calls[0].form.get("max_redemptions"), "1");
  assert.strictEqual(calls[1].form.get("discounts[0][coupon]"), "co_9");
}));

test("errors: method, bad JSON, bad cart, missing config, Stripe failure", () => withEnv(async () => {
  assert.strictEqual((await post({}, "GET")).statusCode, 405);
  assert.strictEqual((await post("{nope")).statusCode, 400);
  assert.strictEqual((await post({ items: [] })).statusCode, 400);
  mockStripe([{ ok: false, body: { error: { message: "Invalid API Key" } } }]);
  const r = await post({ items: [{ id: first.id, qty: 1 }] });
  assert.strictEqual(r.statusCode, 502);
  assert.match(JSON.parse(r.body).error, /Invalid API Key/);
  delete process.env.STRIPE_SECRET_KEY;
  const r2 = await post({ items: [{ id: first.id, qty: 1 }] });
  assert.strictEqual(r2.statusCode, 500);
  assert.match(JSON.parse(r2.body).error, /not configured/);
}));
