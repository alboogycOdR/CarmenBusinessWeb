"use strict";
/* API-surface tests against the local Supabase stack (PR 1).
 *
 * pgTAP (supabase/tests) proves the database rules. This suite proves what a
 * real HTTP client can do through PostgREST and GoTrue, using the same public
 * anon key a browser would hold, plus an end-to-end staff sign-in with TOTP
 * MFA to show privileges only appear at aal2.
 *
 * Requires `npx supabase start`. Run with: npm run test:db
 * Connection details come from SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY, or from `supabase status` when unset. */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function localEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  return { url: s.API_URL, anon: s.ANON_KEY, service: s.SERVICE_ROLE_KEY };
}
const ENV = localEnv();

async function call(path, { key = ENV.anon, token, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(ENV.url + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token || key}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${b64url(crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

/* RFC 6238 TOTP (SHA-1, 30 s, 6 digits), as used by authenticator apps. */
function totp(base32Secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

const PRIVATE_TABLES = ["product_assets", "coupons", "orders", "order_items", "payment_events", "fulfilments",
  "delivery_tokens", "email_events", "admin_profiles", "audit_log"];

test("anon: public catalogue lists published products without delivery data", async () => {
  const r = await call("/rest/v1/public_catalog?select=*&order=sort");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.length, 10);
  assert.ok(r.json.every((p) => typeof p.price_minor === "number" && /^[A-Z]{3}$/.test(p.currency)));
  for (const leak of ["storage_path", "external_url", "courses.example", ".pdf", "instructions", "status"]) {
    assert.ok(!r.text.includes(leak), `catalogue leaks ${leak}`);
  }
  const bundle = r.json.find((p) => p.slug === "bundle");
  assert.deepStrictEqual(bundle.bundle_contents, ["signature-course", "book-one", "book-two", "workbook"]);
});

test("anon: draft and archived products are invisible", async () => {
  const r = await call("/rest/v1/products?select=slug&status=neq.published");
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, []);
});

test("anon: every private table is denied outright", async () => {
  for (const t of PRIVATE_TABLES) {
    const r = await call(`/rest/v1/${t}?select=*`);
    assert.strictEqual(r.status, 401, `${t} returned ${r.status}`);
    assert.strictEqual(r.json.code, "42501", `${t} code`);
  }
});

test("anon: cannot write the catalogue", async () => {
  const ins = await call("/rest/v1/products", { method: "POST", body: { slug: "x", type: "book", title: "x", price_minor: 1, currency: "USD" } });
  assert.strictEqual(ins.status, 401);
  const upd = await call("/rest/v1/products?slug=eq.book-one", { method: "PATCH", body: { price_minor: 1 } });
  assert.strictEqual(upd.status, 401);
  const del = await call("/rest/v1/categories?slug=eq.marketing", { method: "DELETE" });
  assert.strictEqual(del.status, 401);
});

test("no RPC surface: private helpers are not callable", async () => {
  for (const fn of ["staff_role", "is_staff", "is_aal2", "new_order_reference", "audit_row"]) {
    const r = await call(`/rest/v1/rpc/${fn}`, { method: "POST", body: {} });
    assert.strictEqual(r.status, 404, `${fn} returned ${r.status}`);
  }
});

test("forged or unsigned tokens are rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  const forged = signJwt({ role: "service_role", iss: "supabase-demo", exp: now + 600 }, "not-the-real-secret-not-the-real-secret");
  const r1 = await call("/rest/v1/orders?select=*", { token: forged });
  assert.strictEqual(r1.status, 401);
  const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify({ role: "service_role", exp: now + 600 }))}.`;
  const r2 = await call("/rest/v1/orders?select=*", { token: none });
  assert.strictEqual(r2.status, 401);
});

test("public sign-up is disabled (staff are created by an owner only)", async () => {
  const r = await call("/auth/v1/signup", { method: "POST", body: { email: `intruder-${Date.now()}@example.com`, password: "Aa1!aaaaaaaaaaaa" } });
  assert.ok(r.status >= 400 && r.status < 500, `signup returned ${r.status}`);
  assert.match(r.text, /signup|not allowed|disabled/i);
});

test("staff: privileges appear only after TOTP MFA (aal2)", async (t) => {
  const email = `admin-${crypto.randomUUID()}@example.com`;
  const password = `Aa1!${crypto.randomBytes(18).toString("base64url")}`;
  const created = await call("/auth/v1/admin/users", { key: ENV.service, method: "POST", body: { email, password, email_confirm: true } });
  assert.strictEqual(created.status, 200, created.text);
  const userId = created.json.id;
  t.after(() => call(`/auth/v1/admin/users/${userId}`, { key: ENV.service, method: "DELETE" }));

  // A signed-in user without a profile has no staff powers.
  const signIn = async () => {
    const r = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    assert.strictEqual(r.status, 200, r.text);
    return r.json.access_token;
  };
  let token = await signIn();
  assert.deepStrictEqual((await call("/rest/v1/product_assets?select=id", { token })).json, []);

  // Grant the admin role the only way it can be granted: server-side, with the service role.
  const grant = await call("/rest/v1/admin_profiles", { key: ENV.service, method: "POST", body: { user_id: userId, role: "admin" }, headers: { Prefer: "return=minimal" } });
  assert.strictEqual(grant.status, 201, grant.text);

  token = await signIn();
  assert.strictEqual(claims(token).aal, "aal1");
  const own = await call("/rest/v1/admin_profiles?select=role", { token });
  assert.deepStrictEqual(own.json, [{ role: "admin" }], "aal1 sees own role so the UI can prompt for MFA");
  assert.deepStrictEqual((await call("/rest/v1/products?select=slug&status=eq.draft", { token })).json, [], "aal1: no draft products");
  assert.deepStrictEqual((await call("/rest/v1/product_assets?select=id", { token })).json, [], "aal1: no assets");
  const blocked = await call("/rest/v1/products?slug=eq.book-one", { token, method: "PATCH", body: { price_minor: 1 }, headers: { Prefer: "return=representation" } });
  assert.deepStrictEqual(blocked.json, [], "aal1: edits affect nothing");

  // Enrol and verify a TOTP factor exactly as an authenticator app would.
  const factor = await call("/auth/v1/factors", { token, method: "POST", body: { factor_type: "totp", friendly_name: "test" } });
  assert.strictEqual(factor.status, 200, factor.text);
  const challenge = await call(`/auth/v1/factors/${factor.json.id}/challenge`, { token, method: "POST", body: {} });
  assert.strictEqual(challenge.status, 200, challenge.text);
  const wrong = await call(`/auth/v1/factors/${factor.json.id}/verify`, { token, method: "POST",
    body: { challenge_id: challenge.json.id, code: totp(factor.json.totp.secret) === "000000" ? "111111" : "000000" } });
  assert.ok(wrong.status >= 400, "a wrong TOTP code is rejected");
  const challenge2 = await call(`/auth/v1/factors/${factor.json.id}/challenge`, { token, method: "POST", body: {} });
  const verified = await call(`/auth/v1/factors/${factor.json.id}/verify`, { token, method: "POST",
    body: { challenge_id: challenge2.json.id, code: totp(factor.json.totp.secret) } });
  assert.strictEqual(verified.status, 200, verified.text);
  const mfaToken = verified.json.access_token;
  assert.strictEqual(claims(mfaToken).aal, "aal2");

  // Now the admin has catalogue powers, but still cannot touch orders.
  assert.strictEqual((await call("/rest/v1/products?select=slug&status=eq.draft", { token: mfaToken })).json.length, 1);
  assert.strictEqual((await call("/rest/v1/product_assets?select=id", { token: mfaToken })).json.length, 12);
  const before = (await call("/rest/v1/products?select=price_minor&slug=eq.planner", { token: mfaToken })).json[0].price_minor;
  const edit = await call("/rest/v1/products?slug=eq.planner", { token: mfaToken, method: "PATCH", body: { price_minor: before + 100 }, headers: { Prefer: "return=representation" } });
  assert.strictEqual(edit.json[0].price_minor, before + 100, "aal2 admin can edit a product");
  await call("/rest/v1/products?slug=eq.planner", { token: mfaToken, method: "PATCH", body: { price_minor: before } });
  const audit = await call(`/rest/v1/audit_log?select=actor,action&entity=eq.products&actor=eq.${userId}`, { token: mfaToken });
  assert.ok(audit.json.length >= 2, "both edits are attributed to the admin in the audit log");
  const order = await call("/rest/v1/orders", { token: mfaToken, method: "POST",
    body: { email: "x@example.com", access_key_hash: "\\x" + "00".repeat(32), currency: "USD", subtotal_minor: 1, total_minor: 1, provider: "paystack", terms_accepted_at: new Date().toISOString() } });
  assert.strictEqual(order.status, 403, "even an aal2 admin cannot create orders directly");
  const escalate = await call(`/rest/v1/admin_profiles?user_id=eq.${userId}`, { token: mfaToken, method: "PATCH", body: { role: "owner" } });
  assert.strictEqual(escalate.status, 403, "an admin cannot escalate to owner");
});
