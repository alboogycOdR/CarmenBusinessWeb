/*
 * Integration tests for secure downloads (PR 5, spec §7 "Download security"):
 * the real download function, real Supabase Storage (private bucket, real
 * signed URLs) and the real database. Orders are paid through the real ITN
 * handler, with only Payfast's network side faked.
 *
 * Requires the local stack (npm run db:start). Run with: npm run test:db
 */
import test from "node:test";
import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import checkout from "../netlify/functions/checkout.mts";
import { createDownloadHandler, config as downloadConfig } from "../netlify/functions/download.mts";
import { createItnHandler } from "../netlify/functions/payfast-itn.mts";
import { RuleError } from "../netlify/lib/db.mts";
import { itnParamString, phpUrlencode } from "../netlify/lib/payfast.mts";
import { PRODUCT_BUCKET, signedDownloadUrl } from "../netlify/lib/storage.mts";
import { downloadUrl, issueDownloadLinks } from "../scripts/issue-download-links.mts";

function stack(): { url: string; service: string; anon: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY) {
    return { url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY, anon: process.env.SUPABASE_ANON_KEY };
  }
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  return { url: s.API_URL, service: s.SERVICE_ROLE_KEY, anon: s.ANON_KEY };
}
const DB = stack();
const SITE = "http://localhost:8080";
const PASS = "dl-test-passphrase-" + randomBytes(4).toString("hex");
const ENV = {
  SUPABASE_URL: DB.url, SUPABASE_SERVICE_ROLE_KEY: DB.service, SITE_URL: SITE, STORE_NAME: "Carmen",
  PAYFAST_MODE: "sandbox", PAYFAST_MERCHANT_ID: "10000001", PAYFAST_MERCHANT_KEY: "fakekey00000a", PAYFAST_PASSPHRASE: PASS,
};
Object.assign(process.env, ENV);
const CFG = { supabaseUrl: DB.url, serviceKey: DB.service };
const RUN = randomBytes(3).toString("hex");
let txn = Number(BigInt("0x" + randomBytes(4).toString("hex")) % 800_000_000n) + 100_000_000;

const download = createDownloadHandler(ENV);
const itn = createItnHandler({ resolveHost: async () => [], validate: async () => "VALID" }, ENV);

/* Distinct bytes per file, so a download proves WHICH file was served. */
const FILES: Record<string, Buffer> = Object.fromEntries(
  ["signature-course/workbook.pdf", "book-one/the-first-book.pdf", "book-one/the-first-book.epub", "book-two/the-second-book.pdf", "workbook/companion-workbook.pdf"]
    .map((p) => [p, Buffer.concat([Buffer.from("%PDF-1.4\n% test fixture for "), Buffer.from(p), randomBytes(64)])]));

async function admin(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${DB.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

test.before(async () => {
  for (const [path, bytes] of Object.entries(FILES)) {
    const type = path.endsWith(".epub") ? "application/epub+zip" : "application/pdf";
    const res = await fetch(`${DB.url}/storage/v1/object/${PRODUCT_BUCKET}/${path}`, {
      method: "POST", headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": type, "x-upsert": "true" }, body: bytes,
    });
    assert.ok(res.ok, `upload ${path}: ${res.status} ${await res.text()}`);
  }
});

/* Checkout → signed Payfast ITN → paid order; returns the reference and order id. */
async function paidOrder(slugs: string[], tag: string): Promise<{ reference: string; id: string }> {
  const res = await checkout(new Request(`${SITE}/api/checkout`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: SITE },
    body: JSON.stringify({ items: slugs.map((id) => ({ id, qty: 1 })), email: `${tag}-${RUN}@example.com`, termsAccepted: true }),
  }));
  assert.strictEqual(res.status, 201);
  const b = JSON.parse(await res.text());
  const f = Object.fromEntries(b.payment.fields) as Record<string, string>;
  const pairs: Array<[string, string]> = [["m_payment_id", b.reference], ["pf_payment_id", String(txn++)], ["payment_status", "COMPLETE"],
    ["item_name", f.item_name!], ["amount_gross", f.amount!], ["merchant_id", "10000001"]];
  const sig = createHash("md5").update(`${itnParamString(pairs, true)}&passphrase=${phpUrlencode(PASS)}`).digest("hex");
  const paid = await itn(new Request(`${SITE}/api/payfast/itn`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([...pairs, ["signature", sig]]).toString(),
  }), { ip: "197.97.145.150" });
  assert.strictEqual(paid.status, 200, await paid.clone().text());
  const [order] = await admin(`orders?reference=eq.${b.reference}&select=id,status`);
  assert.strictEqual(order.status, "paid");
  return { reference: b.reference, id: order.id };
}

const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;
const view = (token: string) => download(new Request(`${SITE}/api/download?t=${encodeURIComponent(token)}`));
const press = (token: string) => download(new Request(`${SITE}/api/download?t=${encodeURIComponent(token)}`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: token }).toString(),
}));
const tokenRow = async (token: string) => (await admin(`delivery_tokens?token_hash=eq.${encodeURIComponent("\\x" + createHash("sha256").update(Buffer.from(token, "base64url")).digest("hex"))}&select=*`))[0];

test("a valid link: landing page, then a 60-second signed URL to exactly the purchased file", async () => {
  const o = await paidOrder(["book-two"], "valid");
  const { links } = await issueDownloadLinks(CFG, SITE, o.reference);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0]!.url, downloadUrl(SITE, tokenOf(links[0]!.url)));
  const token = tokenOf(links[0]!.url);

  // GET: a page, nothing used up (email scanners open links).
  for (let i = 0; i < 3; i++) {
    const res = await view(token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("cache-control"), "no-store");
    assert.strictEqual(res.headers.get("referrer-policy"), "no-referrer");
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'none'/);
    assert.ok(csp.includes(`form-action 'self' ${new URL(DB.url).origin};`), "the POST may redirect only to storage: " + csp);
    assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
    const html = await res.text();
    assert.match(html, /The Second Book \(PDF\)/);
    assert.match(html, /5 of 5 downloads left/);
    assert.match(html, /<form method="post"/);
    assert.ok(!html.includes("book-two/the-second-book.pdf") && !html.includes("storage"), "no storage path on the page");
  }
  assert.strictEqual((await tokenRow(token)).download_count, 0, "viewing the page consumes nothing");

  // POST: one download counted, 303 to a signed URL.
  const res = await press(token);
  assert.strictEqual(res.status, 303);
  assert.strictEqual(res.headers.get("cache-control"), "no-store");
  assert.strictEqual(res.headers.get("referrer-policy"), "no-referrer");
  const location = res.headers.get("location")!;
  assert.ok(location.startsWith(`${DB.url}/storage/v1/object/sign/${PRODUCT_BUCKET}/book-two/the-second-book.pdf?token=`), location);
  const claims = JSON.parse(Buffer.from(new URL(location).searchParams.get("token")!.split(".")[1]!, "base64url").toString());
  assert.strictEqual(claims.exp - claims.iat, 60, "signed URL lives 60 seconds");

  const file = await fetch(location);
  assert.strictEqual(file.status, 200);
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(FILES["book-two/the-second-book.pdf"]!), "the purchased file, byte for byte");
  assert.match(file.headers.get("content-disposition") ?? "", /attachment; filename=the-second-book\.pdf/);
  assert.strictEqual((await tokenRow(token)).download_count, 1);
  assert.match(await (await view(token)).text(), /4 of 5 downloads left/);
});

test("signed URLs really expire, and the bucket is closed to everyone else", async () => {
  const url = await signedDownloadUrl(CFG, "book-one/the-first-book.pdf", "x.pdf", 1);
  assert.strictEqual((await fetch(url)).status, 200);
  await new Promise((r) => setTimeout(r, 2100));
  assert.notStrictEqual((await fetch(url)).status, 200, "expired signed URL refused");

  const anon = { apikey: DB.anon, Authorization: `Bearer ${DB.anon}` };
  assert.notStrictEqual((await fetch(`${DB.url}/storage/v1/object/${PRODUCT_BUCKET}/book-one/the-first-book.pdf`, { headers: anon })).status, 200, "anon read");
  assert.notStrictEqual((await fetch(`${DB.url}/storage/v1/object/public/${PRODUCT_BUCKET}/book-one/the-first-book.pdf`)).status, 200, "public URL");
  const sign = await fetch(`${DB.url}/storage/v1/object/sign/${PRODUCT_BUCKET}/book-one/the-first-book.pdf`, {
    method: "POST", headers: { ...anon, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }),
  });
  assert.notStrictEqual(sign.status, 200, "anon cannot sign");
  const list = await fetch(`${DB.url}/storage/v1/object/list/${PRODUCT_BUCKET}`, {
    method: "POST", headers: { ...anon, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: "" }),
  });
  assert.deepStrictEqual(list.ok ? await list.json() : [], [], "anon lists nothing");
});

test("spec §7 Download security: unpaid, expired, revoked, over-limit, malformed and unknown links are denied", async (t) => {
  const o = await paidOrder(["book-one"], "deny"); // PDF + EPUB
  const first = await issueDownloadLinks(CFG, SITE, o.reference);
  const [pdf, epub] = first.links.map((l) => tokenOf(l.url));
  const denied = async (token: string, status: number, text: RegExp) => {
    for (const res of [await view(token), await press(token)]) {
      assert.strictEqual(res.status, status);
      assert.strictEqual(res.headers.get("location"), null, "no file");
      const html = await res.text();
      assert.match(html, text);
      assert.match(html, /contact\.html/, "the page says how to get help");
    }
  };

  await t.test("over the limit: 5 downloads, then refused", async () => {
    for (let i = 0; i < 5; i++) assert.strictEqual((await press(pdf!)).status, 303, `download ${i + 1}`);
    await denied(pdf!, 410, /used the maximum 5 times/);
    assert.strictEqual((await tokenRow(pdf!)).download_count, 5);
  });

  await t.test("expired", async () => {
    await admin(`delivery_tokens?id=eq.${(await tokenRow(epub!)).id}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    await denied(epub!, 410, /has expired/);
  });

  await t.test("revoked (new links sent)", async () => {
    const fresh = await issueDownloadLinks(CFG, SITE, o.reference, true);
    await denied(epub!, 410, /no longer active/);
    assert.strictEqual((await press(tokenOf(fresh.links[1]!.url))).status, 303, "the replacement works");
  });

  await t.test("unpaid (order disputed)", async () => {
    const o2 = await paidOrder(["planner"], "disputed");
    const [link] = (await issueDownloadLinks(CFG, SITE, o2.reference)).links;
    await admin(`orders?id=eq.${o2.id}`, { method: "PATCH", body: JSON.stringify({ status: "disputed" }) });
    await denied(tokenOf(link!.url), 403, /can(&#39;|')t be downloaded/);
  });

  await t.test("malformed and unknown", async () => {
    for (const bad of ["", "short", "A".repeat(42), "A".repeat(44), "../../etc/passwd" + "A".repeat(27), "<script>".padEnd(43, "A")]) {
      await denied(bad, 404, /isn(&#39;|')t valid/);
    }
    await denied(randomBytes(32).toString("base64url"), 404, /isn(&#39;|')t valid/);
    const odd = await download(new Request(`${SITE}/api/download?t=${pdf}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: pdf }) }));
    assert.strictEqual(odd.status, 404, "the token is only read from a form post");
  });

  await t.test("an unpaid order gets no links at all", async () => {
    const res = await checkout(new Request(`${SITE}/api/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: SITE },
      body: JSON.stringify({ items: [{ id: "book-two", qty: 1 }], email: `pending-${RUN}@example.com`, termsAccepted: true }),
    }));
    const pending = JSON.parse(await res.text()).reference;
    await assert.rejects(issueDownloadLinks(CFG, SITE, pending), (e: unknown) => e instanceof RuleError && e.code === "order_not_paid");
  });
});

test("concurrent downloads at the limit never exceed it", async () => {
  const o = await paidOrder(["workbook"], "race");
  const token = tokenOf((await issueDownloadLinks(CFG, SITE, o.reference)).links[0]!.url);
  const results = await Promise.all(Array.from({ length: 12 }, () => press(token)));
  const statuses = results.map((r) => r.status);
  assert.strictEqual(statuses.filter((s) => s === 303).length, 5, statuses.join(","));
  assert.strictEqual(statuses.filter((s) => s === 410).length, 7);
  assert.strictEqual((await tokenRow(token)).download_count, 5);
});

test("a storage failure costs the buyer nothing", async () => {
  // signature-course's workbook exists; delete it to simulate a storage fault.
  const o = await paidOrder(["signature-course"], "storagefault");
  const token = tokenOf((await issueDownloadLinks(CFG, SITE, o.reference)).links[0]!.url);
  const del = await fetch(`${DB.url}/storage/v1/object/${PRODUCT_BUCKET}`, {
    method: "DELETE", headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: ["signature-course/workbook.pdf"] }),
  });
  assert.ok(del.ok);
  try {
    const res = await press(token);
    assert.strictEqual(res.status, 503);
    assert.match(await res.text(), /Nothing was used up/);
    assert.strictEqual((await tokenRow(token)).download_count, 0);
  } finally {
    await fetch(`${DB.url}/storage/v1/object/${PRODUCT_BUCKET}/signature-course/workbook.pdf`, {
      method: "POST", headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": "application/pdf", "x-upsert": "true" },
      body: FILES["signature-course/workbook.pdf"],
    });
  }
  assert.strictEqual((await press(token)).status, 303, "works again once the file is back");
});

test("HTTP edge: methods, misconfiguration, hostile labels", async () => {
  assert.strictEqual((await download(new Request(`${SITE}/api/download`, { method: "PUT" }))).status, 405);
  const broken = createDownloadHandler({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" });
  const res = await broken(new Request(`${SITE}/api/download?t=${"A".repeat(43)}`));
  assert.strictEqual(res.status, 503);
  assert.ok(!(await res.text()).includes(DB.url), "no internals leaked");
  assert.strictEqual(downloadConfig.path, "/api/download");
  assert.ok(downloadConfig.rateLimit.windowLimit > 0);

  // A product label is admin-controlled text: it is escaped on the page.
  const o = await paidOrder(["book-two"], "xss");
  const [asset] = await admin("product_assets?storage_path=eq.book-two/the-second-book.pdf&select=id,label");
  await admin(`product_assets?id=eq.${asset.id}`, { method: "PATCH", body: JSON.stringify({ label: `<img src=x onerror=alert(1)> "PDF"` }) });
  try {
    const html = await (await view(tokenOf((await issueDownloadLinks(CFG, SITE, o.reference)).links[0]!.url))).text();
    assert.ok(!html.includes("<img src=x"), "escaped");
    assert.match(html, /&#60;img src=x onerror=alert\(1\)&#62;/);
  } finally {
    await admin(`product_assets?id=eq.${asset.id}`, { method: "PATCH", body: JSON.stringify({ label: asset.label }) });
  }
});
