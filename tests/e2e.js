"use strict";
/* Headless end-to-end test. Serves the site locally, drives real user flows in
 * Chromium and fails on any console/page error or horizontal overflow.
 *   npm run test:e2e            (needs playwright)
 *   SHOTS=/dir npm run test:e2e (also saves full-page screenshots)  */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("nf"); }
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

async function pagesRender(browser, vp, shots) {
  const page = await newPage(browser, vp);
  const urls = [["/", ".card"], ["/product.html?id=signature-course", ".product h1"], ["/cart.html", "h1"], ["/reviews.html", ".review"], ["/free.html", ".free"], ["/about.html", "h1"], ["/contact.html", "form"], ["/success.html", "h1"], ["/terms.html", "h1"], ["/privacy.html", "h1"], ["/404.html", "h1"]];
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
  await page.fill("#f-min", "100"); await page.fill("#f-max", "250"); await page.dispatchEvent("#f-max", "change");
  const prices = await page.locator(".card .price strong").allInnerTexts();
  assert.ok(prices.length && prices.every((p) => { const n = Number(p.replace(/[$,]/g, "")); return n >= 100 && n <= 250; }), "price filter " + prices);
  await page.click("[data-reset]");
  await page.check('input[name="cat"][value="Books"]');
  assert.strictEqual(await page.locator(".card").count(), 4, "4 books");
  assert.match(page.url(), /cat=Books/);
  await page.selectOption("#f-sort", "price-desc");
  const books = (await page.locator(".card .price strong").allInnerTexts()).map((p) => Number(p.replace(/[$,]/g, "")));
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
  await page.locator('[data-add="starter-course"]').click();            // $47
  assert.ok(await page.locator("#drawer").isVisible(), "drawer opens");
  assert.strictEqual(await txt(page, "[data-cart-count]"), "1");
  await page.keyboard.press("Escape");
  assert.ok(!(await page.locator("#drawer").isVisible()), "Esc closes drawer");
  await page.locator('[data-add="book-two"]').click();                    // $19
  await page.click("#drawer [data-inc]");                                  // first line qty -> 2
  assert.strictEqual(await txt(page, "[data-cart-count]"), "3");
  await page.click("#drawer a[href='cart.html']");
  await page.waitForSelector(".cart-grid");
  assert.match(await txt(page, ".totals .grand"), /\$113\.00/, "2x47 + 19");
  step("add to cart, drawer, quantities");

  await page.reload();
  assert.strictEqual(await txt(page, "[data-cart-count]"), "3", "cart survives reload");
  await page.fill("#cp", "nope"); await page.click(".coupon button");
  assert.match(await txt(page, ".coupon .form-msg"), /not valid/);
  await page.fill("#cp", "save10"); await page.click(".coupon button");
  assert.match(await txt(page, ".coupon .form-msg"), /SAVE10 applied/);
  assert.match(await txt(page, ".totals .disc"), /\$11\.30/);
  assert.match(await txt(page, ".totals .grand"), /\$101\.70/);
  step("discount code");

  await page.click("#checkout");
  const msg = await txt(page, "#checkout-msg");
  assert.match(msg, /Email my order/);
  assert.match(await page.locator("#checkout-msg a[href^='mailto:']").getAttribute("href"), /2%20x%20Starter%20Foundations/);
  step("no-server checkout fallback");

  await page.locator("[data-line='book-two'] [data-remove]").click();
  assert.strictEqual(await page.locator(".line").count(), 1);
  await page.locator("[data-line='starter-course'] [data-dec]").click();
  await page.locator("[data-line='starter-course'] [data-dec]").click();
  assert.match(await txt(page, "#view"), /cart is currently empty/);
  await page.close();

  /* server checkout path */
  const p2 = await newPage(browser, { width: 1280, height: 900 }, "window.SITE.checkout.endpoint='/api/checkout';");
  let posted = null;
  await p2.route("**/api/checkout", (r) => { posted = JSON.parse(r.request().postData()); r.fulfill({ contentType: "application/json", body: JSON.stringify({ url: base + "/success.html" }) }); });
  await p2.goto(base + "/");
  await p2.locator('[data-add="workbook"]').click();
  await p2.goto(base + "/cart.html");
  await p2.fill("#cp", "SAVE10"); await p2.click(".coupon button");
  await p2.click("#checkout");
  await p2.waitForURL("**/success.html");
  assert.deepStrictEqual(posted, { items: [{ id: "workbook", qty: 1 }], code: "SAVE10" });
  assert.strictEqual(await txt(p2, "[data-cart-count]"), "0", "cart cleared after success");
  await p2.goto(base + "/cart.html");
  assert.match(await txt(p2, "#view"), /currently empty/);
  step("server checkout + success clears cart");

  const p3 = await newPage(browser, { width: 1280, height: 900 }, "window.SITE.checkout.endpoint='/api/checkout';");
  await p3.route("**/api/checkout", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"x"}' }));
  await p3.goto(base + "/"); await p3.locator('[data-add="workbook"]').click(); await p3.goto(base + "/cart.html");
  await p3.click("#checkout");
  await p3.waitForSelector("#checkout-msg .err");
  assert.ok(await p3.locator("#checkout").isEnabled(), "button re-enabled after failure");
  step("checkout error handling");
  await p2.context().close(); await p3.context().close();
}

async function productFlow(browser) {
  const page = await newPage(browser, { width: 1280, height: 900 });
  await page.goto(base + "/product.html?id=signature-course");
  await page.fill("#qty", "3"); await page.click("#add-main");
  assert.match(await txt(page, "#drawer .totals"), /\$591\.00/, "3 x 197");
  await page.keyboard.press("Escape");
  await page.focus("#t-desc"); await page.keyboard.press("ArrowRight");
  assert.ok(await page.locator("#p-info").isVisible(), "arrow key switches tab");
  assert.match(await txt(page, "#p-info"), /Lifetime/);
  await page.click("#t-rev");
  assert.ok(await page.locator("#p-rev .review").count() >= 3, "product reviews");
  assert.match(await page.locator('script[type="application/ld+json"]').innerText(), /AggregateRating/);
  assert.match(await page.title(), /Signature Course/);
  await page.goto(base + "/product.html?id=ghost");
  assert.match(await txt(page, "#view"), /not found/i);
  await page.goto(base + "/product.html?id=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  assert.strictEqual(await page.locator("#view img").count(), 0, "no HTML injection");
  step("product page, tabs, reviews, JSON-LD, 404 + injection");
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

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
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
