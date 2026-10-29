/* Unit tests for the static build (scripts/build.mts). No database needed:
 * input is real `public_catalog` rows exported from the seeded database. */
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adminConfigScript, BuildError, buildSite, catalogScript, headersFile, injectHead, resolveSiteUrl, robotsTxt, sitemapXml, toProduct, validateCatalog,
  type CatalogRow, type StorefrontProduct,
} from "../scripts/build.mts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROWS: CatalogRow[] = JSON.parse(fs.readFileSync(path.join(here, "fixtures/public_catalog.json"), "utf8"));
const row = (slug: string): CatalogRow => structuredClone(ROWS.find((r) => r.slug === slug)!);
const SITE = "https://shop.example.com";
const tmpOut = () => fs.mkdtempSync(path.join(os.tmpdir(), "cbw-build-"));

test("toProduct maps a database row to the storefront shape", () => {
  const p = toProduct(row("bundle"));
  assert.strictEqual(p.id, "bundle");
  assert.strictEqual(p.type, "bundle");
  assert.strictEqual(p.priceMinor, 229700);
  assert.strictEqual(p.price, 2297);
  assert.strictEqual(p.compareAt, 2574);
  assert.strictEqual(p.currency, "ZAR");
  assert.strictEqual(p.badge, "Save 11%");
  assert.deepStrictEqual(p.color, ["#1f1f1f", "#e50069"]);
  assert.deepStrictEqual(p.bundleContents, ["signature-course", "book-one", "book-two", "workbook"]);
  assert.deepStrictEqual(p.tags, ["Marketing"]);
  assert.strictEqual(p.allowQuantity, false);
  assert.strictEqual(p.image, null);
});

test("toProduct rejects malformed rows instead of publishing them", () => {
  const bad: Array<[string, (r: CatalogRow) => void]> = [
    ["slug", (r) => { r.slug = "Bad Slug"; }],
    ["type", (r) => { r.type = "subscription" as CatalogRow["type"]; }],
    ["title", (r) => { r.title = ""; }],
    ["negative price", (r) => { r.price_minor = -1; }],
    ["fractional minor units", (r) => { r.price_minor = 10.5; }],
    ["currency", (r) => { r.currency = "usd"; }],
    ["unsafe image", (r) => { r.images = [{ src: "javascript:alert(1)" }]; }],
    ["description shape", (r) => { r.description = [1, 2] as unknown as string[]; }],
  ];
  for (const [name, mutate] of bad) {
    const r = row("book-one");
    mutate(r);
    assert.throws(() => toProduct(r), BuildError, name);
  }
});

test("toProduct ignores invalid presentation data rather than injecting it", () => {
  const r = row("planner");
  r.display = { color: ["red;}</style><script>", "#fff"], badge: 7 };
  const p = toProduct(r);
  assert.strictEqual(p.color, null);
  assert.strictEqual(p.badge, null);
});

test("toProduct keeps a safe product image", () => {
  const r = row("planner");
  r.images = [{ src: "/assets/img/planner.webp", alt: "Planner pages", width: 1200, height: 800, srcset: "/assets/img/planner-600.webp 600w" }];
  assert.deepStrictEqual(toProduct(r).image, { src: "/assets/img/planner.webp", alt: "Planner pages", width: 1200, height: 800, srcset: "/assets/img/planner-600.webp 600w" });
});

test("validateCatalog enforces catalogue-wide rules", () => {
  const P = ROWS.map(toProduct);
  assert.doesNotThrow(() => validateCatalog(P, []));
  assert.throws(() => validateCatalog([], []), /empty catalogue/);
  assert.doesNotThrow(() => validateCatalog([], [], { allowEmpty: true }));
  assert.throws(() => validateCatalog([...P, P[0]!], []), /duplicate product slug/);
  assert.throws(() => validateCatalog([P[0]!, { ...P[1]!, currency: "USD" }], []), /mixes currencies/);
  assert.throws(() => validateCatalog(P, [{ name: "x", rating: 5, date: "2026-01-01", productId: "upcoming-course", text: "x" }]), /unknown or unpublished products: upcoming-course/);
});

test("resolveSiteUrl: production needs an explicit origin", () => {
  assert.strictEqual(resolveSiteUrl({ SITE_URL: "https://shop.example.com/" }), "https://shop.example.com");
  assert.strictEqual(resolveSiteUrl({ URL: "https://carmen.netlify.app" }), "https://carmen.netlify.app");
  assert.strictEqual(resolveSiteUrl({}), "http://localhost:8080");
  assert.throws(() => resolveSiteUrl({ CONTEXT: "production" }), /SITE_URL/);
  assert.throws(() => resolveSiteUrl({ SITE_URL: "https://shop.example.com/sub/path" }), /origin/);
  assert.throws(() => resolveSiteUrl({ SITE_URL: "javascript:alert(1)" }), /origin/);
});

test("catalogScript cannot be broken out of by product data", () => {
  const p = { ...toProduct(row("book-two")), title: "</script><script>alert(1)</script> x" } as StorefrontProduct;
  const js = catalogScript([p]);
  assert.ok(!js.includes("</script"), "no closing script tag");
  assert.ok(!js.includes(" "), "no raw line separator");
  const ctx = { window: {} as { CATALOG?: StorefrontProduct[] } };
  new Function("window", js)(ctx.window);
  assert.strictEqual(ctx.window.CATALOG![0]!.title, p.title, "round-trips exactly");
});

test("injectHead adds one canonical and refuses a duplicate", () => {
  const html = injectHead("<html><head><title>x</title></head><body></body></html>", "https://s.example/a.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/s\.example\/a\.html">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/s\.example\/a\.html">/);
  assert.throws(() => injectHead(html, "https://s.example/b.html"), /already has a canonical/);
  assert.throws(() => injectHead("<p>no head</p>", "x"), /no <\/head>/);
});

test("sitemap and robots", () => {
  const P = ROWS.map(toProduct);
  const xml = sitemapXml(SITE, P);
  assert.strictEqual((xml.match(/<url>/g) ?? []).length, 7 + P.length);
  for (const p of P) assert.ok(xml.includes(`<loc>${SITE}/product/${p.id}/</loc>`), p.id);
  assert.ok(!/cart\.html|success\.html|404\.html/.test(xml), "transactional pages are not indexed");
  assert.match(robotsTxt(SITE), new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
  assert.match(robotsTxt(SITE), /Disallow: \/admin\//, "the admin is not crawled");
  assert.ok(!xml.includes("/admin"), "nor listed in the sitemap");
});

test("buildSite writes a complete, SEO-ready site", () => {
  const out = tmpOut();
  try {
    const res = buildSite(ROWS, { outDir: out, siteUrl: SITE });
    assert.strictEqual(res.products, 10);
    const products = fs.readdirSync(path.join(out, "product")).sort();
    assert.deepStrictEqual(products, ROWS.map((r) => r.slug!).sort());
    for (const f of ["index.html", "cart.html", "404.html", "sitemap.xml", "robots.txt", "assets/js/catalog.js", "assets/js/render.js", "assets/css/styles.css"]) {
      assert.ok(fs.existsSync(path.join(out, f)), f);
    }
    assert.ok(!fs.existsSync(path.join(out, "product.html")), "the template is not published");
    assert.ok(!fs.existsSync(path.join(out, "templates")), "templates are not published");

    const titles = new Set<string>();
    const htmlFiles = res.pages.map((p) => (p === "/" ? "index.html" : p.endsWith("/") ? `${p.slice(1)}index.html` : p.slice(1)));
    for (const file of htmlFiles) {
      const html = fs.readFileSync(path.join(out, file), "utf8");
      const title = html.match(/<title>([^<]+)<\/title>/)![1]!;
      assert.ok(!titles.has(title), `duplicate title: ${title}`);
      titles.add(title);
      assert.ok(!html.includes("{{"), `${file} has unfilled template tokens`);
      const canon = html.match(/rel="canonical"/g) ?? [];
      assert.strictEqual(canon.length, file === "404.html" ? 0 : 1, `${file} canonical count`);
    }

    const page = fs.readFileSync(path.join(out, "product/signature-course/index.html"), "utf8");
    assert.match(page, /<link rel="canonical" href="https:\/\/shop\.example\.com\/product\/signature-course\/">/);
    assert.match(page, /<h1>The Signature Course: Your Complete Programme<\/h1>/, "content is pre-rendered for crawlers");
    assert.match(page, /data-product="signature-course"/);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1]!);
    assert.strictEqual(ld["@type"], "Product");
    assert.strictEqual(ld.offers.price, "1997.00");
    assert.strictEqual(ld.offers.priceCurrency, "ZAR");
    assert.strictEqual(ld.aggregateRating.reviewCount, 3, "site-config reviews for this product");
    assert.ok(!page.includes("Build template"), "maintainer comment stripped");
    assert.ok(!page.includes('id="qty"'), "no quantity control for a single-licence product");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("buildSite escapes hostile product text everywhere it lands", () => {
  const out = tmpOut();
  try {
    const r = row("book-two");
    r.title = `Evil <img src=x onerror=alert(1)> "quoted"`;
    r.summary = `</script><script>alert(2)</script>`;
    buildSite([r, ...ROWS.filter((x) => x.slug !== "book-two")], { outDir: out, siteUrl: SITE });
    const page = fs.readFileSync(path.join(out, "product/book-two/index.html"), "utf8");
    assert.ok(!page.includes("<img src=x"), "title is escaped in markup");
    assert.ok(!page.includes("<script>alert(2)"), "summary cannot open a script");
    assert.strictEqual((page.match(/<\/script>/g) ?? []).length, 6, "only the JSON-LD and the 5 site scripts close a script tag");
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1]!);
    assert.strictEqual(ld.name, r.title, "JSON-LD keeps the exact text");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("buildSite refuses to delete anything outside the project or temp dir", () => {
  assert.throws(() => buildSite(ROWS, { outDir: "/etc/cbw", siteUrl: SITE }), /outside the project/);
  assert.throws(() => buildSite(ROWS, { outDir: path.join(here, ".."), siteUrl: SITE }), /outside the project|source directory/);
  assert.throws(() => buildSite(ROWS, { outDir: path.join(here, "../assets"), siteUrl: SITE }), /source directory/);
});

test("admin (PR 8): public config only, and a strict CSP naming this environment's Supabase", () => {
  const sb = { url: "https://abcd.supabase.co/", anonKey: "public-anon-key" };
  const ctx = { window: {} as { ADMIN_CONFIG?: Record<string, string> } };
  new Function("window", adminConfigScript(sb))(ctx.window);
  assert.deepStrictEqual(ctx.window.ADMIN_CONFIG, { supabaseUrl: "https://abcd.supabase.co", anonKey: "public-anon-key" });
  assert.ok(!adminConfigScript({ url: "https://x.supabase.co", anonKey: "</script><script>alert(1)" }).includes("</script"), "cannot break out of the script");
  assert.strictEqual(adminConfigScript(null), "window.ADMIN_CONFIG = {};\n");

  const h = headersFile(sb);
  assert.match(h, /^\/admin\n/);
  assert.match(h, /\n\/admin\/\*\n/);
  assert.match(h, /Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:\/\/abcd\.supabase\.co; form-action 'self'; frame-ancestors 'none'; base-uri 'none'/);
  assert.match(h, /X-Robots-Tag: noindex, nofollow/);
  assert.match(h, /Cache-Control: no-store/);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(h.split("\n").filter((l) => l.includes("Content-Security-Policy")).join("")), "no unsafe-* or wildcards");
  assert.throws(() => headersFile({ url: "not a url", anonKey: "k" }), BuildError);
});

test("buildSite publishes the admin with its config and headers", () => {
  const out = tmpOut();
  try {
    buildSite(ROWS, { outDir: out, siteUrl: SITE, supabase: { url: "https://abcd.supabase.co", anonKey: "anon" } });
    for (const f of ["admin/index.html", "admin/admin.js", "admin/admin.css", "admin/config.js", "_headers"]) assert.ok(fs.existsSync(path.join(out, f)), f);
    const html = fs.readFileSync(path.join(out, "admin/index.html"), "utf8");
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.ok(!/<script>(?!<\/script>)|\son[a-z]+=|style=/.test(html), "no inline script, handlers or styles (CSP)");
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(fs.readFileSync(path.join(out, "admin/admin.js"), "utf8")), "admin.js builds the DOM with text only");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

