"use strict";
/* Headless smoke test: serves the site, loads every page, checks rendering and
 * interactions, fails on any console/page error. Run: npm run test:e2e
 * Set SHOTS=/some/dir to also save screenshots. */
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
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;
  const errors = [];
  for (const vp of [{ width: 1280, height: 900, n: "desktop" }, { width: 390, height: 800, n: "mobile" }]) {
    const page = await browser.newPage({ viewport: vp });
    page.on("pageerror", (e) => errors.push(`${vp.n} pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/fonts\.g/.test(m.text()) && !/ERR_|Failed to load resource/.test(m.text()) && errors.push(`${vp.n} console: ${m.text()}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

    for (const [url, sel] of [["/", "#hero h1"], ["/courses.html", ".card"], ["/books.html", ".card"], ["/shop.html", ".tab"], ["/product.html?id=signature-course", ".product h1"], ["/about.html", "#about h1"], ["/contact.html", "form"]]) {
      await page.goto(base + url);
      await page.waitForSelector(sel, { timeout: 3000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.ok(!overflow, `${vp.n} ${url} horizontal overflow`);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${vp.n}-${url.replace(/\W+/g, "_")}.png`), fullPage: true }); }
    }

    await page.goto(base + "/shop.html");
    const all = await page.locator(".card").count();
    await page.click('.tab[data-type="book"]');
    const books = await page.locator(".card").count();
    assert.ok(books > 0 && books < all, "tab filter narrows results");

    await page.goto(base + "/product.html?id=nope");
    assert.match(await page.textContent("#product"), /not found/i);

    await page.goto(base + "/product.html?id=%3Cimg%20src=x%3E");
    assert.strictEqual(await page.locator("#product img").count(), 0, "no HTML injection via id");

    await page.goto(base + "/");
    await page.fill("#nl-email", "bad");
    await page.click("#newsletter button");
    assert.match(await page.textContent("#newsletter .form-msg"), /valid email/i);

    if (vp.n === "mobile") {
      await page.click(".menu-btn");
      assert.ok(await page.locator("#primary-nav.open").count(), "mobile menu opens");
    }
    await page.close();
  }
  await browser.close();
  server.close();
  assert.deepStrictEqual(errors, [], errors.join("\n"));
  console.log("e2e ok");
})().catch((e) => { console.error(e); process.exit(1); });
