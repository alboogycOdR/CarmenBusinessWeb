/*
 * Static site build (PR 2, ADR-0006).
 *
 * Reads the published catalogue from the database (the `public_catalog` view,
 * via PostgREST with the public anon key: RLS limits it to published rows and
 * the view carries no delivery data) and writes the deployable site to dist/:
 *
 *   dist/<page>.html             static pages, with canonical + og:url injected
 *   dist/assets/**               CSS/JS/images, plus generated assets/js/catalog.js
 *   dist/product/<slug>/index.html  one pre-rendered page per product (SEO, JSON-LD)
 *   dist/sitemap.xml, dist/robots.txt
 *
 * Usage:
 *   node scripts/build.mts                      # reads SUPABASE_URL / SUPABASE_ANON_KEY,
 *                                              # or the local stack via `supabase status`
 *   node scripts/build.mts --rows rows.json     # build from exported view rows (tests)
 *
 * SITE_URL (or Netlify's URL) sets the absolute base for canonical URLs.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import type { Database } from "../types/database.ts";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = require(path.join(ROOT, "assets/js/lib.js"));
const R = require(path.join(ROOT, "assets/js/render.js"));

export type CatalogRow = Database["public"]["Views"]["public_catalog"]["Row"];

export interface ProductImage { src: string; alt?: string; width?: number; height?: number; srcset?: string }

/* The product shape the storefront scripts consume (window.CATALOG). */
export interface StorefrontProduct {
  id: string; // the slug: stable, human-readable, used in URLs and carts
  type: string;
  title: string;
  subtitle: string | null;
  summary: string;
  description: string[];
  included: string[];
  info: Record<string, string>;
  price: number; // major units, display only
  priceMinor: number;
  compareAt: number | null;
  currency: string;
  badge: string | null;
  color: [string, string] | null;
  image: ProductImage | null;
  tags: string[];
  allowQuantity: boolean;
  bundleContents: string[];
  publishedAt: string | null;
}

export interface Review { name: string; rating: number; date: string; productId: string; text: string; verified?: boolean }

export class BuildError extends Error {}

/* Static pages listed in the sitemap (cart/success/404 are deliberately excluded). */
export const SITEMAP_PAGES = ["/", "/reviews.html", "/free.html", "/about.html", "/contact.html", "/terms.html", "/privacy.html"];

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function resolveSiteUrl(env: NodeJS.ProcessEnv): string {
  const raw = env.SITE_URL || env.URL || "";
  if (!raw) {
    if (env.CONTEXT === "production") throw new BuildError("SITE_URL (or Netlify URL) is required for a production build");
    return "http://localhost:8080";
  }
  const url = raw.replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/.test(url)) throw new BuildError(`SITE_URL must be an origin like https://example.com, got "${raw}"`);
  return url;
}

function asStringArray(v: unknown, field: string, slug: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new BuildError(`${slug}: ${field} must be a list of strings`);
  return v as string[];
}

/* Map one view row to the storefront shape, rejecting anything malformed. */
export function toProduct(row: CatalogRow): StorefrontProduct {
  const slug = row.slug ?? "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new BuildError(`invalid product slug "${slug}"`);
  if (!row.type || !L.TYPE_LABEL[row.type]) throw new BuildError(`${slug}: unknown type "${row.type}"`);
  if (!row.title) throw new BuildError(`${slug}: missing title`);
  if (!Number.isInteger(row.price_minor) || (row.price_minor as number) < 0) throw new BuildError(`${slug}: invalid price`);
  if (!row.currency || !/^[A-Z]{3}$/.test(row.currency)) throw new BuildError(`${slug}: invalid currency`);

  const display = (row.display ?? {}) as Record<string, unknown>;
  const color = Array.isArray(display.color) && display.color.length === 2 && display.color.every((c) => typeof c === "string" && HEX.test(c))
    ? (display.color as [string, string]) : null;
  const images = Array.isArray(row.images) ? (row.images as unknown[]) : [];
  const first = images[0] as Record<string, unknown> | undefined;
  let image: ProductImage | null = null;
  if (first && typeof first.src === "string") {
    if (!L.safeUrl(first.src)) throw new BuildError(`${slug}: unsafe image URL`);
    image = {
      src: first.src,
      alt: typeof first.alt === "string" ? first.alt : undefined,
      width: typeof first.width === "number" ? first.width : undefined,
      height: typeof first.height === "number" ? first.height : undefined,
      srcset: typeof first.srcset === "string" ? first.srcset : undefined,
    };
  }
  const info: Record<string, string> = {};
  for (const [k, v] of Object.entries((row.info ?? {}) as Record<string, unknown>)) info[k] = String(v);

  return {
    id: slug,
    type: row.type,
    title: row.title,
    subtitle: row.subtitle ?? null,
    summary: row.summary ?? "",
    description: asStringArray(row.description, "description", slug),
    included: asStringArray(row.included, "included", slug),
    info,
    price: (row.price_minor as number) / 100,
    priceMinor: row.price_minor as number,
    compareAt: row.compare_at_minor == null ? null : row.compare_at_minor / 100,
    currency: row.currency,
    badge: typeof display.badge === "string" ? display.badge : null,
    color,
    image,
    tags: asStringArray(row.categories, "categories", slug),
    allowQuantity: row.allow_quantity === true,
    bundleContents: asStringArray(row.bundle_contents, "bundle_contents", slug),
    publishedAt: row.published_at ?? null,
  };
}

/* Cross-record rules the storefront relies on. */
export function validateCatalog(products: StorefrontProduct[], reviews: Review[], opts: { allowEmpty?: boolean } = {}): void {
  if (!products.length && !opts.allowEmpty) {
    throw new BuildError("refusing to publish an empty catalogue (check SUPABASE_URL / anon key, or set ALLOW_EMPTY_CATALOG=1)");
  }
  const ids = new Set<string>();
  for (const p of products) {
    if (ids.has(p.id)) throw new BuildError(`duplicate product slug "${p.id}"`);
    ids.add(p.id);
  }
  const currencies = new Set(products.map((p) => p.currency));
  if (currencies.size > 1) throw new BuildError(`catalogue mixes currencies (${[...currencies].join(", ")}); the store sells in one currency`);
  const dangling = reviews.filter((r) => !ids.has(r.productId)).map((r) => r.productId);
  if (dangling.length) throw new BuildError(`reviews reference unknown or unpublished products: ${[...new Set(dangling)].join(", ")}`);
}

export function loadSiteConfig(root = ROOT): { brand: { name: string }; reviews: Review[] } {
  const ctx: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "assets/js/site-config.js"), "utf8"), ctx);
  return ctx.window.SITE as { brand: { name: string }; reviews: Review[] };
}

/* window.CATALOG as a script. Escapes "<" and line separators so the JSON can never close the script tag. */
export function catalogScript(products: StorefrontProduct[]): string {
  const json = JSON.stringify(products).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `/* Generated by scripts/build.mts from the database. Do not edit. */\nwindow.CATALOG = ${json};\n`;
}

function replaceOnce(html: string, token: string, value: string, file: string): string {
  const n = html.split(token).length - 1;
  if (n < 1) throw new BuildError(`${file}: expected token ${token}`);
  return html.split(token).join(value);
}

export function injectHead(html: string, canonical: string, extra = ""): string {
  if (!html.includes("</head>")) throw new BuildError("page has no </head>");
  if (html.includes('rel="canonical"')) throw new BuildError("page already has a canonical link");
  const esc = L.esc as (v: unknown) => string;
  return html.replace("</head>", `  <link rel="canonical" href="${esc(canonical)}">\n  <meta property="og:url" content="${esc(canonical)}">\n${extra}</head>`);
}

export function renderProductPage(template: string, p: StorefrontProduct, all: StorefrontProduct[], reviews: Review[], siteUrl: string, siteName: string): string {
  const esc = L.esc as (v: unknown) => string;
  const mine = L.sortReviews(L.filterReviews(reviews, { productId: p.id }), "recent") as Review[];
  const related = all.filter((o) => o.id !== p.id && o.type === p.type).slice(0, 3);
  const url = siteUrl + R.urls.product(p.id);
  // Drop the template's own maintainer comment from published pages.
  let html = template.replace(/^<!-- Build template[^\n]*-->\n/m, "");
  html = replaceOnce(html, "{{TITLE}}", esc(`${p.title} | ${siteName}`), "product template");
  html = replaceOnce(html, "{{DESCRIPTION}}", esc(p.summary), "product template");
  html = replaceOnce(html, "{{SLUG}}", esc(p.id), "product template");
  html = replaceOnce(html, "{{VIEW}}", R.productView(p, mine, related), "product template");
  const og = p.image ? `  <meta property="og:image" content="${esc(new URL(p.image.src, siteUrl).href)}">\n` : "";
  const ld = `  <script type="application/ld+json">${R.productJsonLd(p, mine, url)}</script>\n`;
  return injectHead(html, url, og + ld);
}

export function sitemapXml(siteUrl: string, products: StorefrontProduct[]): string {
  const esc = L.esc as (v: unknown) => string;
  const urls = [
    ...SITEMAP_PAGES.map((p) => `  <url><loc>${esc(siteUrl + p)}</loc></url>`),
    ...products.map((p) => `  <url><loc>${esc(siteUrl + R.urls.product(p.id))}</loc>${p.publishedAt ? `<lastmod>${esc(p.publishedAt.slice(0, 10))}</lastmod>` : ""}</url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function robotsTxt(siteUrl: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /cart.html\nDisallow: /success.html\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

/* The public Supabase settings the browser may know (URL + anon key). */
export interface PublicSupabase { url: string; anonKey: string }

/* The admin's browser config: only the public URL and anon key (RLS-limited). */
export function adminConfigScript(sb: PublicSupabase | null): string {
  const cfg = sb ? { supabaseUrl: sb.url.replace(/\/+$/, ""), anonKey: sb.anonKey } : {};
  return `window.ADMIN_CONFIG = ${JSON.stringify(cfg).replace(/</g, "\\u003c")};\n`;
}

/* Netlify _headers for the admin (PR 8): the CSP must name this environment's
 * Supabase origin, so it is generated here rather than kept in netlify.toml. */
export function headersFile(sb: PublicSupabase | null): string {
  let origin = "";
  if (sb) {
    try { origin = new URL(sb.url).origin; } catch { throw new BuildError(`SUPABASE_URL is not a URL: ${sb.url}`); }
  }
  const csp = [
    "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
    `connect-src 'self'${origin ? " " + origin : ""}`, "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'",
  ].join("; ");
  const rules = ["Content-Security-Policy: " + csp, "X-Robots-Tag: noindex, nofollow", "Cache-Control: no-store"];
  return ["/admin", "/admin/*"].map((p) => `${p}\n${rules.map((r) => "  " + r).join("\n")}`).join("\n") + "\n";
}

export function resolvePublicSupabase(env: NodeJS.ProcessEnv): PublicSupabase {
  let url = env.SUPABASE_URL;
  let key = env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (env.CI || env.NETLIFY) throw new BuildError("SUPABASE_URL and SUPABASE_ANON_KEY must be set for the build");
    try { // local development: read the running local stack
      const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const s = JSON.parse(out.slice(out.indexOf("{")));
      url = s.API_URL; key = s.ANON_KEY;
    } catch {
      throw new BuildError("no SUPABASE_URL/SUPABASE_ANON_KEY and no local Supabase running (npm run db:start)");
    }
  }
  return { url: String(url).replace(/\/+$/, ""), anonKey: String(key) };
}

/* Fetch published rows through the public API, exactly as any browser could. */
export async function fetchCatalogRows(sb: PublicSupabase): Promise<CatalogRow[]> {
  const res = await fetch(`${sb.url}/rest/v1/public_catalog?select=*&order=sort.asc,slug.asc`, {
    headers: { apikey: sb.anonKey, Authorization: `Bearer ${sb.anonKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new BuildError(`catalogue fetch failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as CatalogRow[];
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export interface BuildResult { outDir: string; products: number; pages: string[] }

export function buildSite(rows: CatalogRow[], opts: { outDir: string; siteUrl: string; root?: string; allowEmpty?: boolean; supabase?: PublicSupabase | null }): BuildResult {
  const root = opts.root ?? ROOT;
  const outDir = path.resolve(opts.outDir);
  // fs.rmSync below deletes outDir: only ever inside the project or the OS temp dir.
  const tmp = fs.realpathSync(os.tmpdir());
  if (!outDir.startsWith(root + path.sep) && !outDir.startsWith(tmp + path.sep)) {
    throw new BuildError(`refusing to write outside the project: ${outDir}`);
  }
  if (outDir === root || outDir === path.join(root, "assets") || outDir === path.join(root, "supabase")) {
    throw new BuildError(`refusing to use a source directory as output: ${outDir}`);
  }
  const site = loadSiteConfig(root);
  const products = rows.map(toProduct);
  validateCatalog(products, site.reviews, { allowEmpty: opts.allowEmpty });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  copyDir(path.join(root, "assets"), path.join(outDir, "assets"));
  fs.writeFileSync(path.join(outDir, "assets/js/catalog.js"), catalogScript(products));

  const pages: string[] = [];
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".html")).sort()) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const pathname = file === "index.html" ? "/" : `/${file}`;
    fs.writeFileSync(path.join(outDir, file), file === "404.html" ? html : injectHead(html, opts.siteUrl + pathname));
    pages.push(pathname);
  }

  const template = fs.readFileSync(path.join(root, "templates/product.html"), "utf8");
  for (const p of products) {
    const dir = path.join(outDir, "product", p.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), renderProductPage(template, p, products, site.reviews, opts.siteUrl, site.brand.name));
    pages.push(R.urls.product(p.id));
  }

  fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemapXml(opts.siteUrl, products));
  fs.writeFileSync(path.join(outDir, "robots.txt"), robotsTxt(opts.siteUrl));

  // Staff admin (PR 8): static shell, its public config and its security headers.
  copyDir(path.join(root, "admin"), path.join(outDir, "admin"));
  fs.writeFileSync(path.join(outDir, "admin/config.js"), adminConfigScript(opts.supabase ?? null));
  fs.writeFileSync(path.join(outDir, "_headers"), headersFile(opts.supabase ?? null));
  return { outDir, products: products.length, pages };
}

async function main(argv: string[]): Promise<void> {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const rowsFile = arg("--rows");
  const outDir = arg("--out") ?? path.join(ROOT, "dist");
  const supabase = rowsFile ? null : resolvePublicSupabase(process.env);
  const rows = rowsFile ? (JSON.parse(fs.readFileSync(rowsFile, "utf8")) as CatalogRow[]) : await fetchCatalogRows(supabase!);
  const siteUrl = resolveSiteUrl(process.env);
  const result = buildSite(rows, { outDir, siteUrl, allowEmpty: process.env.ALLOW_EMPTY_CATALOG === "1", supabase });
  console.log(`built ${result.pages.length} pages (${result.products} products) into ${path.relative(ROOT, result.outDir) || "."} for ${siteUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof BuildError ? `build failed: ${e.message}` : e);
    process.exit(1);
  });
}
