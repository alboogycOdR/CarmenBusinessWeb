"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const L = require("../assets/js/lib.js");

function loadConfig() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "assets/js/site-config.js"), "utf8"), ctx);
  return ctx.window.SITE;
}
const S = loadConfig();
const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html"));

test("esc neutralises HTML", () => {
  assert.strictEqual(L.esc('<img src=x onerror="a()">&\''), "&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;");
  assert.strictEqual(L.esc(null), "");
});

test("formatPrice", () => {
  assert.strictEqual(L.formatPrice(197, "USD"), "$197");
  assert.strictEqual(L.formatPrice(19.5, "USD"), "$19.50");
  assert.strictEqual(L.formatPrice("abc"), "");
});

test("discountPercent", () => {
  assert.strictEqual(L.discountPercent({ price: 197, compareAt: 297 }), 34);
  assert.strictEqual(L.discountPercent({ price: 10 }), 0);
  assert.strictEqual(L.discountPercent({ price: 10, compareAt: 5 }), 0);
});

test("safeUrl blocks script schemes", () => {
  assert.strictEqual(L.safeUrl("https://buy.stripe.com/abc"), "https://buy.stripe.com/abc");
  assert.strictEqual(L.safeUrl("javascript:alert(1)"), "");
  assert.strictEqual(L.safeUrl("data:text/html,x"), "");
  assert.strictEqual(L.safeUrl(""), "");
  assert.strictEqual(L.safeUrl("contact.html?x=1"), "contact.html?x=1");
});

test("isEmail / mailtoHref", () => {
  assert.ok(L.isEmail("a@b.co"));
  assert.ok(!L.isEmail("a@b"));
  assert.ok(!L.isEmail(""));
  assert.match(L.mailtoHref("hi@x.com", "A B", "line\n2"), /^mailto:hi@x\.com\?subject=A%20B&body=line%0A2$/);
});

test("filter / get product", () => {
  assert.ok(L.filterProducts(S.products, "course").every((p) => p.type === "course"));
  assert.strictEqual(L.filterProducts(S.products, "all").length, S.products.length);
  assert.strictEqual(L.getProduct(S.products, "nope"), null);
});

test("product data is valid and ids are unique", () => {
  const ids = new Set();
  for (const p of S.products) {
    assert.ok(/^[a-z0-9-]+$/.test(p.id), `bad id ${p.id}`);
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.ok(["course", "book", "bundle"].includes(p.type), `bad type ${p.id}`);
    assert.ok(p.title && p.summary && p.price > 0, `incomplete ${p.id}`);
    assert.ok(Array.isArray(p.description) && Array.isArray(p.features), `lists ${p.id}`);
    assert.strictEqual(p.checkoutUrl === "" || L.safeUrl(p.checkoutUrl) !== "", true, `unsafe checkout ${p.id}`);
  }
  assert.ok(ids.has(S.hero.featuredId), "hero.featuredId must exist");
});

test("every page loads the shared scripts and local refs resolve", () => {
  assert.ok(pages.length >= 8);
  for (const f of pages) {
    const html = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(html, /<title>[^<]+<\/title>/, `${f} title`);
    assert.match(html, /name="viewport"/, `${f} viewport`);
    for (const m of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg|html))(?:[?#][^"]*)?"/g)) {
      assert.ok(fs.existsSync(path.join(root, m[1])), `${f} -> missing ${m[1]}`);
    }
  }
});

test("nav and config links point at real pages", () => {
  const targets = [...S.nav.map((n) => n.href), S.hero.primary.href, S.hero.secondary.href];
  for (const t of targets) assert.ok(fs.existsSync(path.join(root, t.split(/[?#]/)[0])), `missing ${t}`);
});
