"use strict";
/* Headless end-to-end test. Serves the BUILT site (dist/, from `npm run build`)
 * the way Netlify does (directory index, legacy redirect, 404 page), drives real
 * user flows in Chromium and fails on any console/page error or horizontal overflow.
 *   npm run build && npm run test:e2e
 *   SHOTS=/dir npm run test:e2e (also saves full-page screenshots)  */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..", "dist");
if (!fs.existsSync(path.join(root, "assets/js/catalog.js"))) {
  console.error("dist/ not built: run `npm run build` first (needs the local Supabase stack).");
  process.exit(1);
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };
/* The real Netlify function handlers, run against the local database (loaded in main). */
const api = {};
async function serveApi(handler, req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(base + req.url, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/* Mirrors Netlify: /api/* functions, the product.html?id= redirect, files, then the 404 page. */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (api[url.pathname]) return void serveApi(api[url.pathname], req, res).catch((e) => { res.writeHead(500); res.end(String(e)); });
  if (url.pathname === "/product.html" && url.searchParams.get("id")) {
    res.writeHead(301, { Location: `/product/${encodeURIComponent(url.searchParams.get("id"))}/` });
    return res.end();
  }
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { p = "/__bad__"; }
  let file = path.join(root, p);
  if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/html" });
    return res.end(fs.readFileSync(path.join(root, "404.html")));
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
const CONFIG = fs.readFileSync(path.join(root, "assets/js/site-config.js"), "utf8");
const errors = [];
let base;

async function newPage(browser, vp, patch) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/site-config\.js/, (r) =>
    r.fulfill({ contentType: "text/javascript", body: CONFIG + "\nwindow.SITE.popup.enabled=false;\n" + (patch || "") }));
  return page;
}
const txt = (page, sel) => page.locator(sel).first().innerText();
const step = (n) => process.stdout.write(`  ok ${n}\n`);
const rand = (text) => Number(text.replace(/[^0-9.]/g, "")); // "R1 997.00" -> 1997

async function pagesRender(browser, vp, shots) {
  const page = await newPage(browser, vp);
  const urls = [["/", ".card"], ["/product/signature-course/", ".product h1"], ["/cart.html", "h1"], ["/reviews.html", ".review"], ["/free.html", ".free"], ["/about.html", "h1"], ["/contact.html", "form"], ["/success.html", "h1"], ["/terms.html", "h1"], ["/privacy.html", "h1"], ["/404.html", "h1"]];
  for (const [u, sel] of urls) {
    await page.goto(base + u);
    await page.waitForSelector(sel, { timeout: 4000 });
    assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${vp.width}px overflow on ${u}`);
    assert.ok((await page.locator("#site-header .logo").count()) === 1 && (await page.locator("#site-footer").innerText()).includes("Terms"), `chrome on ${u}`);
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${vp.width}-${u.replace(/\W+/g, "_")}.png`), fullPage: true }); }
  }
  await page.context().close();
}

async function shopFlow(browser) {
  const page = await newPage(browser, { width: 1280, height: 900 });
  await page.goto(base + "/");
  await page.waitForSelector(".card");
  assert.strictEqual(await page.locator(".card").count(), 9, "9 per page");
  assert.match(await txt(page, "#count"), /Showing 10 results/);
  assert.strictEqual(await page.locator(".pager a[data-page='2']").count() > 0, true);
  await page.click(".pager a[data-page='2']");
  assert.strictEqual(await page.locator(".card").count(), 1, "page 2 has the 10th product");
  assert.match(page.url(), /page=2/);
  step("pagination");

  await page.goto(base + "/");
  await page.fill("#f-q", "workbook"); await page.press("#f-q", "Enter");
  assert.strictEqual(await page.locator(".card").count(), 3, "search matches workbook in title or summary");
  await page.click("[data-reset]");
  await page.fill("#f-min", "1000"); await page.fill("#f-max", "2500"); await page.dispatchEvent("#f-max", "change");
  const prices = await page.locator(".card .price strong").allInnerTexts();
  assert.ok(prices.length === 2 && prices.every((p) => { const n = rand(p); return n >= 1000 && n <= 2500; }), "price filter " + prices);
  await page.click("[data-reset]");
  await page.check('input[name="cat"][value="Books"]');
  assert.strictEqual(await page.locator(".card").count(), 2, "2 books (workbook and planner are a template and a guide)");
  assert.match(page.url(), /cat=Books/);
  await page.selectOption("#f-sort", "price-desc");
  const books = (await page.locator(".card .price strong").allInnerTexts()).map(rand);
  assert.deepStrictEqual(books, [...books].sort((a, b) => b - a), "sorted desc");
  await page.fill("#f-q", "zzz"); await page.press("#f-q", "Enter");
  assert.match(await txt(page, "#results"), /No products match/);
  step("search / price / category / sort / empty state");

  await page.goto(base + "/?cat=Courses&sort=price-asc");
  assert.ok(await page.locator('input[name="cat"][value="Courses"]').isChecked(), "URL restores filters");
  assert.strictEqual(await page.locator("#f-sort").inputValue(), "price-asc");
  await page.close();
}

async function cartFlow(browser) {
  const page = await newPage(browser, { width: 1280, height: 900 });
  await page.goto(base + "/");
  await page.locator('[data-add="starter-course"]').click();            // R497
  assert.ok(await page.locator("#drawer").isVisible(), "drawer opens");
  assert.strictEqual(await txt(page, "[data-cart-count]"), "1");
  await page.keyboard.press("Escape");
  assert.ok(!(await page.locator("#drawer").isVisible()), "Esc closes drawer");
  await page.locator('[data-add="book-two"]').click();                    // R199
  await page.keyboard.press("Escape");
  await page.locator('[data-add="book-two"]').click();                    // again: still one licence (ADR-0008)
  assert.strictEqual(await txt(page, "[data-cart-count]"), "2");
  assert.strictEqual(await page.locator("#drawer [data-inc], #drawer [data-qty-input]").count(), 0, "no quantity controls for single licences");
  await page.click("#drawer a[href='/cart.html']");
  await page.waitForSelector(".cart-grid");
  assert.match(await txt(page, ".totals .grand"), /R696\.00/, "497 + 199");
  step("add to cart, drawer, single-licence quantities");

  await page.reload();
  assert.strictEqual(await txt(page, "[data-cart-count]"), "2", "cart survives reload");
  await page.fill("#cp", "nope"); await page.click(".coupon button");
  assert.match(await txt(page, ".coupon .form-msg"), /checked when you pay/, "unknown codes are left to the server");
  await page.fill("#cp", "save10"); await page.click(".coupon button");
  assert.match(await txt(page, ".coupon .form-msg"), /SAVE10 applied/);
  assert.match(await txt(page, ".totals .disc"), /R69\.60/);
  assert.match(await txt(page, ".totals .grand"), /R626\.40/);
  step("discount code");

  await page.locator("[data-line='book-two'] [data-remove]").click();
  assert.strictEqual(await page.locator(".line").count(), 1);
  await page.locator("[data-line='starter-course'] [data-remove]").click();
  assert.match(await txt(page, "#view"), /cart is currently empty/);
  await page.close();

  /* Static preview without functions: the customer can still email the order. */
  const p0 = await newPage(browser, { width: 1280, height: 900 }, "window.SITE.checkout.endpoint='';");
  await p0.goto(base + "/"); await p0.locator('[data-add="starter-course"]').click(); await p0.goto(base + "/cart.html");
  await p0.click("#pay");
  assert.match(await txt(p0, "#checkout-msg"), /Email my order/);
  assert.match(await p0.locator("#checkout-msg a[href^='mailto:']").getAttribute("href"), /1%20x%20Starter%20Foundations/);
  step("no-functions fallback: email the order");
  await p0.context().close();

  /* Real checkout: browser -> /api/checkout (real function + database) -> signed form -> Payfast (stubbed host). */
  const { signature } = await import("../netlify/lib/payfast.mts");
  const p2 = await newPage(browser, { width: 1280, height: 900 });
  const posts = [];
  await p2.route("https://sandbox.payfast.co.za/**", (r) => {
    posts.push(r.request().postData());
    r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Payfast sandbox (stub)</h1>" });
  });
  const payThrough = async () => {
    await Promise.all([p2.waitForURL("https://sandbox.payfast.co.za/**"), p2.click("#pay")]);
    const pairs = [...new URLSearchParams(posts.at(-1))];
    const fields = Object.fromEntries(pairs);
    assert.strictEqual(fields.signature, signature(pairs.filter(([k]) => k !== "signature"), process.env.PAYFAST_PASSPHRASE), "browser posted the fields in signed order, unaltered");
    return fields;
  };
  await p2.goto(base + "/"); await p2.locator('[data-add="workbook"]').click(); await p2.goto(base + "/cart.html");
  await p2.click("#pay");
  assert.match(await txt(p2, "#checkout-msg"), /valid email/);
  await p2.fill("#co-email", "e2e-" + Date.now() + "@example.com");
  await p2.click("#pay");
  assert.match(await txt(p2, "#checkout-msg"), /Terms/);
  await p2.check("#co-terms");
  const paid = await payThrough();
  assert.strictEqual(paid.amount, "129.00", "server-priced amount (R129.00)");
  assert.match(paid.m_payment_id, /^CBW-/);
  step("checkout: validation, server pricing, signed Payfast post");

  // Back from Payfast: the page must NOT claim success until the server says paid (spec 4.1).
  await p2.goto(`${base}/success.html?ref=${paid.m_payment_id}`);
  await p2.waitForSelector('#order-status[data-state="pending"]');
  assert.strictEqual(await txt(p2, "[data-cart-count]"), "1", "cart kept while unconfirmed");
  await admin(`orders?reference=eq.${paid.m_payment_id}`, { method: "PATCH", body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString(), provider_txn_id: "e2e-" + paid.m_payment_id }) });
  await p2.waitForSelector('#order-status[data-state="paid"]', { timeout: 10000 });
  assert.match(await txt(p2, "h1"), /Payment received/);
  assert.strictEqual(await txt(p2, "[data-cart-count]"), "0", "cart cleared only after server confirmation");
  step("success page: neutral until the server confirms, then paid");

  // A code only the server knows (FIXED20, R20 off) is applied at checkout.
  await p2.goto(base + "/"); await p2.locator('[data-add="workbook"]').click(); await p2.goto(base + "/cart.html");
  await p2.fill("#cp", "fixed20"); await p2.click(".coupon button");
  await p2.fill("#co-email", "e2e-fixed-" + Date.now() + "@example.com"); await p2.check("#co-terms");
  const fixed = await payThrough();
  assert.strictEqual(fixed.amount, "109.00", "R129.00 - R20.00 coupon, priced by the server");
  await p2.goto(`${base}/cart.html?cancelled=${fixed.m_payment_id}`);
  assert.match(await txt(p2, ".cart-page .notice"), /cancelled/);
  assert.strictEqual(await p2.locator(".line").count(), 1, "cancelling keeps the cart");
  await admin(`orders?reference=eq.${fixed.m_payment_id}`, { method: "PATCH", body: JSON.stringify({ status: "expired" }) });
  await p2.goto(`${base}/success.html?ref=${fixed.m_payment_id}`);
  await p2.waitForSelector('#order-status[data-state="unpaid"]');
  step("server-only coupon, cancel keeps cart, expired order shown as not completed");
  await p2.context().close();

  const p3 = await newPage(browser, { width: 1280, height: 900 });
  await p3.goto(`${base}/success.html?ref=CBW-0000000000`);
  await p3.waitForSelector('#order-status[data-state="unknown"]');
  await p3.route("**/api/checkout", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"x"}' }));
  await p3.goto(base + "/"); await p3.locator('[data-add="workbook"]').click(); await p3.goto(base + "/cart.html");
  await p3.fill("#co-email", "x@example.com"); await p3.check("#co-terms");
  await p3.click("#pay");
  await p3.waitForSelector("#checkout-msg .err");
  assert.ok(await p3.locator("#pay").isEnabled(), "button re-enabled after failure");
  step("unknown order on another device; checkout error handling");
  await p3.context().close();
}

async function productFlow(browser) {
  // Crawlers and no-JS clients get real content: the page is pre-rendered.
  const raw = await (await fetch(base + "/product/signature-course/")).text();
  assert.match(raw, /<h1>The Signature Course: Your Complete Programme<\/h1>/, "pre-rendered h1");
  assert.match(raw, /<link rel="canonical" href="[^"]+\/product\/signature-course\/">/);

  const page = await newPage(browser, { width: 1280, height: 900 });
  await page.goto(base + "/product/signature-course/");
  assert.strictEqual(await page.locator("#qty").count(), 0, "no quantity field for a single licence");
  assert.strictEqual(await page.locator(".buy a").count(), 0, "no external Buy now link (G7)");
  await page.click("#add-main");
  await page.keyboard.press("Escape");
  await page.click("#add-main");
  assert.match(await txt(page, "#drawer .totals"), /R1\s997\.00/, "adding twice keeps one licence");
  await page.keyboard.press("Escape");
  await page.focus("#t-desc"); await page.keyboard.press("ArrowRight");
  assert.ok(await page.locator("#p-info").isVisible(), "arrow key switches tab");
  assert.match(await txt(page, "#p-info"), /Lifetime/);
  await page.click("#t-rev");
  assert.ok(await page.locator("#p-rev .review").count() >= 3, "product reviews");
  assert.strictEqual(await page.locator("#p-rev .verified").count(), 0, "placeholder reviews are not badged as verified (G8)");
  assert.strictEqual(await page.locator('script[type="application/ld+json"]').count(), 1, "exactly one JSON-LD block");
  assert.match(await page.locator('script[type="application/ld+json"]').innerText(), /AggregateRating/);
  assert.match(await page.title(), /Signature Course/);
  await page.click(".cats a >> nth=0");
  await page.waitForSelector(".card");
  assert.ok(await page.locator('input[name="cat"][value="Courses"]').isChecked(), "category link opens the filtered shop");

  const legacy = await page.goto(base + "/product.html?id=book-one");
  assert.match(page.url(), /\/product\/book-one\/$/, "old product URLs redirect");
  assert.strictEqual(legacy.status(), 200);
  assert.match(await txt(page, ".product h1"), /The First Book/);

  const missing = await page.goto(base + "/product/ghost/");
  assert.strictEqual(missing.status(), 404);
  assert.match(await txt(page, "h1"), /Page not found/);
  assert.strictEqual(await page.locator("link[rel=stylesheet][href='/assets/css/styles.css']").count(), 1, "404 page loads its assets from any depth");
  assert.strictEqual(await page.locator("#site-header .logo").count(), 1, "site chrome renders on the 404 page");

  const draft = await page.goto(base + "/product/upcoming-course/");
  assert.strictEqual(draft.status(), 404, "draft products are not published");
  await page.goto(base + "/product/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E/");
  assert.strictEqual(await page.locator("#view img").count(), 0, "no HTML injection");
  step("product page: pre-render, single licence, tabs, reviews, JSON-LD, redirects, 404s");
  await page.close();
}

async function reviewsFlow(browser) {
  const page = await newPage(browser, { width: 1280, height: 900 });
  await page.goto(base + "/reviews.html");
  assert.match(await txt(page, ".score"), /Based on 12 reviews/);
  assert.strictEqual(await page.locator(".review").count(), 10);
  await page.click(".pager a[data-page='2']");
  assert.strictEqual(await page.locator(".review").count(), 2);
  await page.fill("#rq", "community");
  assert.ok((await page.locator(".review").count()) >= 1 && (await page.locator(".review").count()) < 12);
  await page.fill("#rq", "qqqq");
  assert.match(await txt(page, "#rv-list"), /No reviews match/);
  await page.fill("#rq", ""); await page.selectOption("#rs", "low");
  assert.match(await page.locator(".review .stars").first().getAttribute("aria-label"), /^3 out of 5/);
  step("reviews summary / pagination / search / sort");
  await page.close();
}

async function popupAndForms(browser) {
  const page = await newPage(browser, { width: 1280, height: 900 }, "window.SITE.popup.enabled=true;window.SITE.popup.delaySeconds=0;");
  await page.goto(base + "/");
  await page.waitForSelector(".popup:not([hidden])");
  await page.fill("#pp-email", "bad"); await page.click(".popup button[type=submit]");
  assert.match(await txt(page, ".popup .form-msg"), /valid email/);
  await page.fill("#pp-name", "Ada"); await page.fill("#pp-email", "ada@example.com");
  await page.route(/^mailto:/, (r) => r.abort());
  await Promise.all([page.waitForSelector('.popup [data-step="done"]:not([hidden])'), page.click(".popup button[type=submit]")]);
  assert.match(await txt(page, ".popup .code"), /SAVE10/);
  await page.keyboard.press("Escape");
  await page.locator('[data-add="workbook"]').click();
  assert.match(await txt(page, "#drawer .totals"), /Discount \(SAVE10\)/, "code auto-applied");
  await page.reload();
  await page.waitForTimeout(300);
  assert.ok(!(await page.locator(".popup").count()), "popup not shown again");
  step("newsletter popup + auto-applied code");

  const p2 = await newPage(browser, { width: 1280, height: 900 }, "window.SITE.popup.enabled=true;window.SITE.popup.delaySeconds=0;");
  await p2.goto(base + "/"); await p2.waitForSelector(".popup:not([hidden])");
  await p2.keyboard.press("Escape");
  await p2.reload(); await p2.waitForTimeout(300);
  assert.ok(!(await p2.locator(".popup").count()), "dismissed popup stays dismissed");
  await p2.goto(base + "/free.html");
  await p2.click("[data-signup]");
  assert.ok(await p2.locator(".popup").isVisible(), "free guide reopens signup");
  await p2.context().close();

  const f = await newPage(browser, { width: 1280, height: 900 }, "window.SITE.brand.formEndpoint='/api/form';");
  let sent = null;
  await f.route("**/api/form", (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await f.goto(base + "/contact.html?product=book-one");
  assert.match(await f.locator("#c-msg").inputValue(), /The First Book/);
  await f.click("form button[type=submit]");
  assert.match(await txt(f, ".form-msg"), /valid email/);
  await f.fill("#c-email", "x@y.com"); await f.click("form button[type=submit]");
  assert.match(await txt(f, ".form-msg"), /Please fill/);
  await f.fill("#c-first", "Ada"); await f.fill("#c-last", "L");
  await f.click("form button[type=submit]");
  await f.waitForFunction(() => /Thank you/.test(document.querySelector(".form-msg").textContent));
  assert.strictEqual(sent.name, "Ada L"); assert.strictEqual(sent.email, "x@y.com");
  step("contact form validation + submission");
  await f.context().close(); await page.close();
}

async function mobile(browser) {
  const page = await newPage(browser, { width: 390, height: 800 });
  await page.goto(base + "/");
  await page.click(".menu-btn");
  assert.ok(await page.locator("#primary-nav.open").isVisible(), "mobile menu");
  await page.click(".menu-btn");
  assert.ok(!(await page.locator("#filters").isVisible()), "filters collapsed on mobile");
  await page.click(".filter-toggle");
  assert.ok(await page.locator("#filters").isVisible(), "filters toggle");
  step("mobile menu + filters");
  await page.close();
}

async function admin(pathAndQuery, init = {}) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${pathAndQuery}: ${res.status} ${await res.text()}`);
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  // Function environment: the local stack plus fake Payfast sandbox credentials.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { execFileSync } = require("node:child_process");
    for (const line of execFileSync("node", [path.join(__dirname, "../scripts/supabase-env.mts")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")) {
      const at = line.indexOf("="); process.env[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  Object.assign(process.env, { SITE_URL: base, PAYFAST_MODE: "sandbox", PAYFAST_MERCHANT_ID: "10000001", PAYFAST_MERCHANT_KEY: "fakekey00000a", PAYFAST_PASSPHRASE: "e2e-passphrase-" + process.pid });
  api["/api/checkout"] = (await import("../netlify/functions/checkout.mts")).default;
  api["/api/order-status"] = (await import("../netlify/functions/order-status.mts")).default;
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;
  try {
    await pagesRender(browser, { width: 1280, height: 900 }, shots);
    await pagesRender(browser, { width: 390, height: 800 }, shots);
    step("all pages render, no overflow (desktop + mobile)");
    await shopFlow(browser);
    await cartFlow(browser);
    await productFlow(browser);
    await reviewsFlow(browser);
    await popupAndForms(browser);
    await mobile(browser);
  } finally {
    await browser.close(); server.close();
  }
  assert.deepStrictEqual(errors, [], "browser errors:\n" + errors.join("\n"));
  console.log("e2e ok");
})().catch((e) => { console.error(e); process.exit(1); });
