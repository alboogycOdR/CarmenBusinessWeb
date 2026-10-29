/*
 * Integration tests for admin access (PR 8, spec §7 "Admin access"): the real
 * admin functions against real Supabase Auth (passwords, TOTP MFA, sessions)
 * and the real database. Staff are created with the owner-run script and sign
 * in through the real one-time password link.
 *
 * Requires the local stack (npm run db:start). Run with: npm run test:db
 */
import test from "node:test";
import assert from "node:assert";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createAuditHandler, config as auditConfig } from "../netlify/functions/admin-audit.mts";
import { createSessionHandler, config as sessionConfig } from "../netlify/functions/admin-session.mts";
import { grantAdmin, resetAdmin, revokeAdmin, AdminScriptError } from "../scripts/grant-admin.mts";
import { totp } from "./support/totp.mts";

const S = (() => {
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
})();
const URL_ = process.env.SUPABASE_URL ?? S.API_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? S.SERVICE_ROLE_KEY!;
const ANON = process.env.SUPABASE_ANON_KEY ?? S.ANON_KEY!;
const SITE = "http://localhost:8080";
const ENV = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON, SITE_URL: SITE };
const CFG = { supabaseUrl: URL_, serviceKey: SERVICE, anonKey: ANON };
const RUN = randomBytes(3).toString("hex");
const session = createSessionHandler(ENV);
const auditLog = createAuditHandler(ENV);

async function gotrue(path: string, init: { method?: string; token?: string; body?: unknown; key?: string } = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${URL_}/auth/v1${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: init.key ?? ANON, "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const claims = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString());

/* Follow the one-time link exactly as a browser would and set a password. */
async function acceptLink(link: string, password: string): Promise<void> {
  const res = await fetch(link, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  assert.match(location, /^http:\/\/localhost:8080\/admin\/#/, "the link lands on the admin page");
  const frag = new URLSearchParams(location.split("#")[1]);
  assert.strictEqual(frag.get("type"), "recovery");
  const put = await gotrue("/user", { method: "PUT", token: frag.get("access_token")!, body: { password } });
  assert.strictEqual(put.status, 200, JSON.stringify(put.body));
}

async function signIn(email: string, password: string): Promise<string> {
  const r = await gotrue("/token?grant_type=password", { method: "POST", body: { email, password } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.body.access_token;
}

/* Enrol (first time) or answer a challenge; returns an aal2 token and the secret. */
async function mfa(aal1: string, secret?: string): Promise<{ token: string; secret: string }> {
  let factorId: string;
  if (!secret) {
    const e = await gotrue("/factors", { method: "POST", token: aal1, body: { factor_type: "totp", friendly_name: "phone " + randomBytes(2).toString("hex") } });
    assert.strictEqual(e.status, 200);
    factorId = e.body.id;
    secret = e.body.totp.secret as string;
  } else {
    const u = await gotrue("/user", { token: aal1 });
    factorId = u.body.factors.find((f: any) => f.status === "verified").id;
  }
  const ch = await gotrue(`/factors/${factorId}/challenge`, { method: "POST", token: aal1, body: {} });
  const v = await gotrue(`/factors/${factorId}/verify`, { method: "POST", token: aal1, body: { challenge_id: ch.body.id, code: totp(secret) } });
  assert.strictEqual(v.status, 200, JSON.stringify(v.body));
  assert.strictEqual(claims(v.body.access_token).aal, "aal2");
  return { token: v.body.access_token, secret };
}

const call = (handler: (r: Request) => Promise<Response>, path: string, token: string | null, init: RequestInit = {}) =>
  handler(new Request(SITE + path, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } }));
async function body(res: Response): Promise<any> { return JSON.parse(await res.text()); }

/* HS256 token signed with the local stack's JWT secret (for expiry/session tests). */
function mint(payload: Record<string, unknown>, secret = S.JWT_SECRET!): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const data = `${head}.${enc(payload)}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}

const PW = "Owner-Test-" + randomBytes(4).toString("hex") + "A9";
const owner = { email: `owner-${RUN}@example.com`, secret: "", aal1: "", aal2: "", id: "" };

test.before(async () => {
  const g = await grantAdmin(CFG, SITE, owner.email, "owner", "Carmen");
  owner.id = g.userId;
  assert.strictEqual(g.created, true);
  await acceptLink(g.link, PW);
  owner.aal1 = await signIn(owner.email, PW);
  const m = await mfa(owner.aal1);
  owner.aal2 = m.token;
  owner.secret = m.secret;
});

test("owner: password alone (aal1) is refused everywhere; after MFA (aal2) the admin opens", async () => {
  for (const [h, p] of [[session, "/api/admin/session"], [auditLog, "/api/admin/audit"]] as const) {
    const r = await call(h, p, owner.aal1);
    assert.strictEqual(r.status, 403, p);
    assert.deepStrictEqual(await body(r), { error: "mfa_required" });
  }
  const me = await call(session, "/api/admin/session", owner.aal2);
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.headers.get("cache-control"), "no-store");
  assert.deepStrictEqual(await body(me), { email: owner.email, role: "owner", displayName: "Carmen", mfa: true });
});

test("sign-ins are audited and readable by the owner (through RLS with the owner's own token)", async () => {
  const post = await call(session, "/api/admin/session", owner.aal2, { method: "POST", headers: { Origin: SITE } });
  assert.strictEqual(post.status, 200);
  const r = await call(auditLog, "/api/admin/audit?limit=20", owner.aal2);
  assert.strictEqual(r.status, 200);
  const { entries } = await body(r);
  const signIn = entries.find((e: any) => e.what === "sign_in" && e.entityId === claims(owner.aal2).session_id);
  assert.ok(signIn, "the sign-in is in the log");
  assert.strictEqual(signIn.who, "Carmen");
  assert.strictEqual(signIn.label, "Signed in to the admin");
  assert.ok(entries.some((e: any) => e.label === "Staff profile added"), "row changes get plain-English labels");
  assert.ok(entries.some((e: any) => e.what === "grant_admin"), "the owner-run grant is in the log too");
  assert.strictEqual((await call(session, "/api/admin/session", owner.aal2, { method: "POST", headers: { Origin: "https://evil.example" } })).status, 403, "cross-site POST refused");
});

test("support: signs in, but cannot read the audit log", async () => {
  const email = `support-${RUN}@example.com`;
  const pw = "Support-Test-" + randomBytes(4).toString("hex") + "B7";
  await acceptLink((await grantAdmin(CFG, SITE, email, "support", null)).link, pw);
  const { token } = await mfa(await signIn(email, pw));
  assert.strictEqual((await body(await call(session, "/api/admin/session", token))).role, "support");
  const r = await call(auditLog, "/api/admin/audit", token);
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(await body(r), { error: "forbidden" });
});

test("an account without an admin profile is refused even with MFA", async () => {
  const email = `nobody-${RUN}@example.com`;
  const pw = "Nobody-Test-" + randomBytes(4).toString("hex") + "C5";
  const c = await gotrue("/admin/users", { method: "POST", key: SERVICE, token: SERVICE, body: { email, password: pw, email_confirm: true } });
  assert.strictEqual(c.status, 200);
  const { token } = await mfa(await signIn(email, pw));
  for (const [h, p] of [[session, "/api/admin/session"], [auditLog, "/api/admin/audit"]] as const) {
    const r = await call(h, p, token);
    assert.strictEqual(r.status, 403);
    assert.deepStrictEqual(await body(r), { error: "not_staff" });
  }
  // No route to self-assign: the API refuses a profile insert with the user's own token.
  const self = await fetch(`${URL_}/rest/v1/admin_profiles`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: claims(token).sub, role: "owner" }),
  });
  assert.ok(self.status === 401 || self.status === 403, `self-assign refused (${self.status})`);
  assert.strictEqual((await call(session, "/api/admin/session", token)).status, 403, "still not staff");
});

test("forged, tampered, expired, session-less and anonymous tokens → 401", async () => {
  const now = Math.floor(Date.now() / 1000);
  const real = claims(owner.aal2);
  const cases: Array<[string, string | null, Record<string, string>?]> = [
    ["no token", null],
    ["not a JWT", "garbage"],
    ["wrong scheme", null, { Authorization: `Basic ${owner.aal2}` }],
    ["tampered payload (original signature)", `${owner.aal2.split(".")[0]}.${Buffer.from(JSON.stringify({ ...claims(owner.aal1), aal: "aal2" })).toString("base64url")}.${owner.aal1.split(".")[2]}`],
    ["signed with another key", mint({ ...real, exp: now + 3600 }, "not-the-secret-" + randomBytes(8).toString("hex"))],
    ["expired", mint({ ...real, iat: now - 7200, exp: now - 3600 })],
    ["valid signature, no such session", mint({ ...real, session_id: randomUUID(), exp: now + 3600 })],
    ["the anon key", ANON],
    ["the anon key with a forged role", mint({ role: "authenticated", aal: "aal2", sub: owner.id, exp: now + 3600 }, "x")],
  ];
  for (const [name, token, headers] of cases) {
    const r = await call(session, "/api/admin/session", token, { headers: headers ?? {} });
    assert.strictEqual(r.status, 401, name);
    assert.deepStrictEqual(await body(r), { error: "unauthenticated" }, name);
    assert.strictEqual(r.headers.get("www-authenticate"), "Bearer", name);
  }
});

test("signing out ends the session for the admin API", async () => {
  const pw2 = PW;
  const t = await mfa(await signIn(owner.email, pw2), owner.secret);
  assert.strictEqual((await call(session, "/api/admin/session", t.token)).status, 200);
  assert.strictEqual((await gotrue("/logout?scope=local", { method: "POST", token: t.token })).status, 204);
  assert.strictEqual((await call(session, "/api/admin/session", t.token)).status, 401);
});

test("revoking access works immediately; re-granting restores it; reset removes the authenticator", async () => {
  const email = `temp-${RUN}@example.com`;
  const pw = "Temp-Test-" + randomBytes(4).toString("hex") + "D3";
  await acceptLink((await grantAdmin(CFG, SITE, email, "admin", "Temp")).link, pw);
  const first = await mfa(await signIn(email, pw));
  assert.strictEqual((await call(session, "/api/admin/session", first.token)).status, 200);

  await revokeAdmin(CFG, email);
  const profile = await fetch(`${URL_}/rest/v1/admin_profiles?user_id=eq.${claims(first.token).sub}&select=role`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then((r) => r.json());
  assert.deepStrictEqual(profile, [], "the admin profile is removed (not only the sign-in blocked)");
  const after = await call(session, "/api/admin/session", first.token);
  assert.ok([401, 403].includes(after.status), `revoked session refused (${after.status})`);
  assert.notStrictEqual((await gotrue("/token?grant_type=password", { method: "POST", body: { email, password: pw } })).status, 200, "and cannot sign in");

  const again = await grantAdmin(CFG, SITE, email, "admin", "Temp");
  assert.strictEqual(again.created, false);
  const back = await mfa(await signIn(email, pw), first.secret);
  assert.strictEqual((await call(session, "/api/admin/session", back.token)).status, 200, "re-granted");

  const reset = await resetAdmin(CFG, SITE, email);
  assert.strictEqual(reset.factorsRemoved, 1);
  const u = await gotrue("/user", { token: await signIn(email, pw) });
  assert.deepStrictEqual(u.body.factors ?? [], [], "a new authenticator must be set up");
  await assert.rejects(grantAdmin(CFG, SITE, "not-an-email", "admin", null), AdminScriptError);
  await assert.rejects(grantAdmin(CFG, SITE, email, "superuser" as "admin", null), AdminScriptError);
});

test("the database agrees: without MFA the owner's own token reads no orders", async () => {
  const read = (t: string) => fetch(`${URL_}/rest/v1/orders?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${t}` } }).then((r) => r.json());
  const aal1 = await signIn(owner.email, PW);
  assert.deepStrictEqual(await read(aal1), [], "aal1: RLS returns nothing");
  const { token } = await mfa(aal1, owner.secret);
  assert.ok(Array.isArray(await read(token)), "aal2: readable");
});

test("HTTP edge: methods, misconfiguration, routes", async () => {
  assert.strictEqual((await call(session, "/api/admin/session", owner.aal2, { method: "DELETE" })).status, 405);
  assert.strictEqual((await call(auditLog, "/api/admin/audit", owner.aal2, { method: "POST" })).status, 405);
  const broken = createSessionHandler({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" });
  assert.strictEqual((await call(broken, "/api/admin/session", owner.aal2)).status, 503);
  assert.strictEqual(sessionConfig.path, "/api/admin/session");
  assert.strictEqual(auditConfig.path, "/api/admin/audit");
  assert.ok(sessionConfig.rateLimit.windowLimit > 0 && auditConfig.rateLimit.windowLimit > 0);
});
