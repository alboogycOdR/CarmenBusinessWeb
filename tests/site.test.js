"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const L = require("../assets/js/lib.js");

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "assets/js/site-config.js"), "utf8"), ctx);
const S = ctx.window.SITE;
const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html"));

test("esc neutralises HTML", () => {
  assert.strictEqual(L.esc('<img src=x onerror="a()">&\''), "&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;");
  assert.strictEqual(L.esc(null), "");
});

test("formatPrice / toCents", () => {
  assert.strictEqual(L.formatPrice(197, "USD"), "$197.00");
  assert.strictEqual(L.formatPrice("abc"), "");
  assert.strictEqual(L.toCents(19.99), 1999);
  assert.strictEqual(L.toCents(0.1 + 0.2), 30);
});

test("categories combine type label and tags, deduplicated", () => {
  const cats = L.allCategories(S.products);
  assert.ok(cats.includes("Courses") && cats.includes("Books") && cats.includes("Bundles"));
  assert.strictEqual(new Set(cats).size, cats.length);
  assert.deepStrictEqual(L.categoriesOf({ type: "book", tags: ["Mindset"] }), ["Books", "Mindset"]);
});

test("filterProducts: text, price range, categories (any-of)", () => {
  const P = S.products;
  assert.strictEqual(L.filterProducts(P, {}).length, P.length);
  assert.ok(L.filterProducts(P, { q: "WORKBOOK" }).every((p) => /workbook/i.test(p.title + p.summary + (p.subtitle || ""))));
  assert.ok(L.filterProducts(P, { min: 100, max: 250 }).every((p) => p.price >= 100 && p.price <= 250));
  assert.ok(L.filterProducts(P, { min: "", max: "" }).length === P.length);
  const books = L.filterProducts(P, { cats: ["Books"] });
  assert.ok(books.length > 0 && books.every((p) => p.type === "book"));
  const either = L.filterProducts(P, { cats: ["Books", "Courses"] });
  assert.strictEqual(either.length, P.filter((p) => p.type !== "bundle").length);
  assert.strictEqual(L.filterProducts(P, { q: "zzzz-no-match" }).length, 0);
});

test("sortProducts does not mutate and orders correctly", () => {
  const P = S.products, ids = P.map((p) => p.id);
  const asc = L.sortProducts(P, "price-asc");
  assert.deepStrictEqual(P.map((p) => p.id), ids);
  for (let i = 1; i < asc.length; i++) assert.ok(asc[i - 1].price <= asc[i].price);
  const desc = L.sortProducts(P, "price-desc");
  assert.strictEqual(desc[0].price, Math.max(...P.map((p) => p.price)));
  assert.deepStrictEqual(L.sortProducts(P, "featured").map((p) => p.id), ids);
});

test("paginate clamps pages", () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  assert.deepStrictEqual(L.paginate(items, 1, 9).items.length, 9);
  assert.strictEqual(L.paginate(items, 3, 9).items.length, 5);
  assert.strictEqual(L.paginate(items, 99, 9).page, 3);
  assert.strictEqual(L.paginate(items, "abc", 9).page, 1);
  assert.strictEqual(L.paginate([], 1, 9).pages, 1);
});

test("cart: add, set, remove, cap, count", () => {
  let c = [];
  c = L.cartAdd(c, "a"); c = L.cartAdd(c, "a", 2); c = L.cartAdd(c, "b");
  assert.deepStrictEqual(c, [{ id: "a", qty: 3 }, { id: "b", qty: 1 }]);
  assert.strictEqual(L.cartCount(c), 4);
  assert.deepStrictEqual(L.cartSet(c, "a", 0), [{ id: "b", qty: 1 }]);
  assert.deepStrictEqual(L.cartSet(c, "a", "5")[0], { id: "a", qty: 5 });
  assert.strictEqual(L.cartSet(c, "a", 5000)[0].qty, L.MAX_QTY);
  assert.strictEqual(L.cartAdd([{ id: "a", qty: 98 }], "a", 50)[0].qty, L.MAX_QTY);
  assert.strictEqual(L.cartAdd([], "a", -4)[0].qty, 1);
  assert.deepStrictEqual(L.cartSet(c, "a", "junk"), [{ id: "b", qty: 1 }]);
});

test("parseCart rejects junk, unknown ids and duplicates", () => {
  const ok = S.products[0].id;
  assert.deepStrictEqual(L.parseCart("not json", S.products), []);
  assert.deepStrictEqual(L.parseCart('{"a":1}', S.products), []);
  assert.deepStrictEqual(L.parseCart(null, S.products), []);
  const raw = JSON.stringify([{ id: ok, qty: 2 }, { id: ok, qty: 9 }, { id: "ghost", qty: 1 }, { id: ok + "x", qty: 0 }, null, { id: 5, qty: 1 }]);
  assert.deepStrictEqual(L.parseCart(raw, S.products), [{ id: ok, qty: 2 }]);
});

test("cartTotals: exact cents, discount code, invalid code", () => {
  const p = [{ id: "x", price: 19.99 }, { id: "y", price: 47 }];
  const lines = L.cartLines([{ id: "x", qty: 3 }, { id: "y", qty: 1 }, { id: "gone", qty: 1 }], p);
  assert.strictEqual(lines.length, 2);
  const d = { SAVE10: { percent: 10 } };
  const t = L.cartTotals(lines, "save10", d);
  assert.deepStrictEqual([t.subtotal, t.discount, t.total, t.code, t.percent], [10697, 1070, 9627, "SAVE10", 10]);
  const bad = L.cartTotals(lines, "NOPE", d);
  assert.deepStrictEqual([bad.discount, bad.total, bad.code], [0, 10697, ""]);
  assert.strictEqual(L.cartTotals(lines, "__proto__", d).discount, 0);
  assert.strictEqual(L.cartTotals([], "SAVE10", d).total, 0);
});

test("reviews: summary, search, sort", () => {
  const R = [
    { name: "A", rating: 5, date: "2026-01-02", productId: "p1", text: "great", helpful: 1 },
    { name: "B", rating: 3, date: "2026-03-01", productId: "p2", text: "okay course", helpful: 9 },
    { name: "C", rating: 5, date: "2026-02-01", productId: "p1", text: "love it", helpful: 4 },
  ];
  const s = L.reviewSummary(R);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.average, 4.3);
  assert.deepStrictEqual([s.dist[5], s.dist[3], s.dist[1]], [67, 33, 0]);
  assert.deepStrictEqual(L.reviewSummary([]), { count: 0, average: 0, dist: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
  const override = { count: 3122, average: 4.9, dist: { 5: 97 } };
  assert.strictEqual(L.reviewSummary(R, override), override);
  assert.strictEqual(L.filterReviews(R, { productId: "p1" }).length, 2);
  assert.strictEqual(L.filterReviews(R, { q: "COURSE" }).length, 1);
  assert.deepStrictEqual(L.sortReviews(R, "recent").map((r) => r.name), ["B", "C", "A"]);
  assert.deepStrictEqual(L.sortReviews(R, "helpful").map((r) => r.name), ["B", "C", "A"]);
  assert.deepStrictEqual(L.sortReviews(R, "high").map((r) => r.name), ["C", "A", "B"]);
  assert.deepStrictEqual(L.sortReviews(R, "low").map((r) => r.name), ["B", "C", "A"]);
});

test("safeUrl blocks script schemes", () => {
  assert.strictEqual(L.safeUrl("https://buy.stripe.com/abc"), "https://buy.stripe.com/abc");
  assert.strictEqual(L.safeUrl("javascript:alert(1)"), "");
  assert.strictEqual(L.safeUrl("data:text/html,x"), "");
  assert.strictEqual(L.safeUrl(""), "");
  assert.strictEqual(L.safeUrl("assets/img/a.webp"), "assets/img/a.webp");
});

test("isEmail / mailtoHref", () => {
  assert.ok(L.isEmail("a@b.co") && !L.isEmail("a@b") && !L.isEmail(""));
  assert.match(L.mailtoHref("hi@x.com", "A B", "line\n2"), /^mailto:hi@x\.com\?subject=A%20B&body=line%0A2$/);
});

test("config: products valid, ids unique, hero/reviews reference real products", () => {
  const ids = new Set();
  for (const p of S.products) {
    assert.ok(/^[a-z0-9-]+$/.test(p.id), `bad id ${p.id}`);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    assert.ok(["course", "book", "bundle"].includes(p.type), p.id);
    assert.ok(p.title && p.summary && p.price > 0, p.id);
    assert.ok(Array.isArray(p.description) && p.description.length && Array.isArray(p.included) && p.included.length, p.id);
    assert.ok(Array.isArray(p.color) && p.color.length === 2, p.id);
    assert.ok(p.checkoutUrl === "" || L.safeUrl(p.checkoutUrl) !== "", `unsafe checkout ${p.id}`);
    assert.ok(p.image === "" || L.safeUrl(p.image) !== "", `unsafe image ${p.id}`);
    assert.strictEqual(Math.round(p.price * 100) / 100, p.price, `price has >2 decimals ${p.id}`);
  }
  for (const r of S.reviews) {
    assert.ok(ids.has(r.productId), `review for unknown product ${r.productId}`);
    assert.ok(r.rating >= 1 && r.rating <= 5 && /^\d{4}-\d{2}-\d{2}$/.test(r.date), JSON.stringify(r));
  }
  assert.ok(S.products.length > S.shop.perPage, "sample catalogue should demo pagination");
  for (const [code, rule] of Object.entries(S.checkout.discounts)) assert.ok(rule.percent > 0 && rule.percent < 100, code);
  assert.ok(S.checkout.discounts[S.popup.code], "popup code must be a valid discount");
});

test("every page has metadata and loads the shared scripts; local refs resolve", () => {
  assert.ok(pages.length >= 11);
  for (const f of pages) {
    const html = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(html, /<title>[^<]+<\/title>/, `${f} title`);
    assert.match(html, /name="viewport"/, `${f} viewport`);
    assert.match(html, /<html lang="en">/, `${f} lang`);
    if (f !== "404.html" && !/legal/.test(html.match(/data-page="(\w+)"/)[1])) assert.match(html, /id="view"/, `${f} view`);
    for (const s of ["site-config.js", "lib.js", "main.js"]) assert.ok(html.includes(`assets/js/${s}`), `${f} missing ${s}`);
    for (const m of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg|html))(?:[?#][^"]*)?"/g)) {
      assert.ok(fs.existsSync(path.join(root, m[1])), `${f} -> missing ${m[1]}`);
    }
  }
});

test("nav, footer and config links point at real pages", () => {
  for (const n of S.nav) assert.ok(fs.existsSync(path.join(root, n.href.split(/[?#]/)[0])), n.href);
  for (const f of ["terms.html", "privacy.html", "cart.html", "success.html"]) assert.ok(pages.includes(f), f);
});
