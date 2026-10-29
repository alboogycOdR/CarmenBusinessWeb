"use strict";
/* Post-build checks against the REAL database (PR 2, risk R4).
 * Run after `npm run build` with the local Supabase stack up: npm run test:build
 *
 * Reads every private delivery value with the service role and proves none of
 * them reached the public build output, and that the published catalogue
 * matches the database exactly (no drafts, no archived products). */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DIST = path.join(__dirname, "..", "dist");

function localEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  return { url: s.API_URL, service: s.SERVICE_ROLE_KEY };
}
const ENV = localEnv();

async function admin(table, select) {
  const res = await fetch(`${ENV.url}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: ENV.service, Authorization: `Bearer ${ENV.service}` },
  });
  assert.strictEqual(res.status, 200, `${table}: ${res.status}`);
  return res.json();
}

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test("dist exists (run npm run build first)", () => {
  assert.ok(fs.existsSync(path.join(DIST, "assets/js/catalog.js")), "dist/assets/js/catalog.js missing");
});

test("no private delivery data or server secrets anywhere in the build output", async () => {
  const assets = await admin("product_assets", "storage_path,external_url,instructions,manual_eta_text");
  assert.ok(assets.length > 0, "seed has assets to check against");
  const secrets = new Set([ENV.service]);
  for (const a of assets) {
    for (const v of [a.storage_path, a.external_url, a.instructions, a.manual_eta_text]) if (v) secrets.add(v);
  }
  const leaks = [];
  for (const file of allFiles(DIST)) {
    const text = fs.readFileSync(file, "utf8");
    for (const s of secrets) if (text.includes(s)) leaks.push(`${path.relative(DIST, file)} contains "${s.slice(0, 40)}"`);
    for (const word of ["storage_path", "external_url", "service_role", "SUPABASE_SERVICE_ROLE_KEY", "PAYFAST_PASSPHRASE"]) {
      if (text.includes(word)) leaks.push(`${path.relative(DIST, file)} mentions ${word}`);
    }
  }
  assert.deepStrictEqual(leaks, [], leaks.join("\n"));
});

test("published catalogue matches the database exactly", async () => {
  const products = await admin("products", "slug,status,price_minor,currency");
  const ctx = { window: {} };
  new Function("window", fs.readFileSync(path.join(DIST, "assets/js/catalog.js"), "utf8"))(ctx.window);
  const built = ctx.window.CATALOG;

  const published = products.filter((p) => p.status === "published").map((p) => p.slug).sort();
  assert.deepStrictEqual(built.map((p) => p.id).sort(), published, "catalog.js lists exactly the published products");
  assert.deepStrictEqual(fs.readdirSync(path.join(DIST, "product")).sort(), published, "one page per published product");

  for (const hidden of products.filter((p) => p.status !== "published")) {
    assert.ok(!fs.existsSync(path.join(DIST, "product", hidden.slug)), `${hidden.status} product ${hidden.slug} must not be published`);
  }
  for (const p of built) {
    const db = products.find((x) => x.slug === p.id);
    assert.strictEqual(p.priceMinor, db.price_minor, `${p.id} price`);
    assert.strictEqual(p.currency, db.currency, `${p.id} currency`);
  }
});
