/*
 * Manage staff accounts (PR 8, D10: Carmen is the owner). Owner-run, with the
 * service role. There is no sign-up page: this script is the only way an
 * account gets admin access (spec §4.3).
 *
 *   node scripts/grant-admin.mts --email <e> --role owner|admin|support [--name "Carmen"]
 *       Creates the account if needed, sets its role, and prints a one-time
 *       link to choose a password. On first sign-in the admin page requires
 *       setting up an authenticator app (TOTP); nothing is shown before that.
 *   node scripts/grant-admin.mts --email <e> --reset
 *       New password link and removes the authenticator (lost phone).
 *   node scripts/grant-admin.mts --email <e> --revoke
 *       Removes admin access at once and blocks the account from signing in.
 *
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SITE_URL. Every change is
 * written to the audit log. Roles: owner (everything, incl. refunds and staff),
 * admin (catalogue and orders), support (read-only, resend/renew links).
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadDbConfig, type DbConfig } from "../netlify/lib/config.mts";
import { audit, type StaffRole } from "../netlify/lib/auth.mts";

const ROLES: StaffRole[] = ["owner", "admin", "support"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class AdminScriptError extends Error {}

async function call<T>(cfg: DbConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${cfg.supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new AdminScriptError(`${path.split("?")[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface AuthUser { id: string; email: string; factors?: Array<{ id: string; factor_type: string }> }

async function findUser(cfg: DbConfig, email: string): Promise<AuthUser | null> {
  // The admin API lists users page by page; staff accounts are few.
  for (let page = 1; page <= 50; page++) {
    const r = await call<{ users: AuthUser[] }>(cfg, `/auth/v1/admin/users?page=${page}&per_page=200`);
    const hit = r.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (r.users.length < 200) return null;
  }
  throw new AdminScriptError("too many users to search");
}

async function passwordLink(cfg: DbConfig, siteUrl: string, email: string): Promise<string> {
  const r = await call<{ action_link?: string; properties?: { action_link?: string } }>(cfg, "/auth/v1/admin/generate_link", {
    method: "POST", body: JSON.stringify({ type: "recovery", email, redirect_to: `${siteUrl}/admin/` }),
  });
  const link = r.action_link ?? r.properties?.action_link;
  if (!link) throw new AdminScriptError("no link returned");
  return link;
}

export async function grantAdmin(cfg: DbConfig, siteUrl: string, emailIn: string, role: StaffRole, name: string | null): Promise<{ userId: string; created: boolean; link: string }> {
  const email = emailIn.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AdminScriptError("not an email address");
  if (!ROLES.includes(role)) throw new AdminScriptError("role must be owner, admin or support");
  let user = await findUser(cfg, email);
  const created = !user;
  if (!user) {
    // No usable password: the person chooses one through the one-time link.
    user = await call<AuthUser>(cfg, "/auth/v1/admin/users", {
      method: "POST", body: JSON.stringify({ email, email_confirm: true, password: randomBytes(32).toString("base64url") + "aA1!" }),
    });
  } else {
    await call(cfg, `/auth/v1/admin/users/${user.id}`, { method: "PUT", body: JSON.stringify({ ban_duration: "none" }) });
  }
  await call(cfg, "/rest/v1/admin_profiles?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: user.id, role, display_name: name }),
  });
  await audit(cfg, null, "grant_admin", "admin_profiles", user.id, { email, role, created });
  return { userId: user.id, created, link: await passwordLink(cfg, siteUrl, email) };
}

export async function resetAdmin(cfg: DbConfig, siteUrl: string, emailIn: string): Promise<{ link: string; factorsRemoved: number }> {
  const email = emailIn.trim().toLowerCase();
  const user = await findUser(cfg, email);
  if (!user) throw new AdminScriptError("no such account");
  const full = await call<AuthUser>(cfg, `/auth/v1/admin/users/${user.id}`);
  let removed = 0;
  for (const f of full.factors ?? []) {
    await call(cfg, `/auth/v1/admin/users/${user.id}/factors/${f.id}`, { method: "DELETE" });
    removed++;
  }
  await audit(cfg, null, "reset_admin", "admin_profiles", user.id, { email, factors_removed: removed });
  return { link: await passwordLink(cfg, siteUrl, email), factorsRemoved: removed };
}

export async function revokeAdmin(cfg: DbConfig, emailIn: string): Promise<void> {
  const email = emailIn.trim().toLowerCase();
  const user = await findUser(cfg, email);
  if (!user) throw new AdminScriptError("no such account");
  await call(cfg, `/rest/v1/admin_profiles?user_id=eq.${user.id}`, { method: "DELETE" });
  // Block sign-in too (a revoked person keeps no session that could be re-granted).
  await call(cfg, `/auth/v1/admin/users/${user.id}`, { method: "PUT", body: JSON.stringify({ ban_duration: "876000h" }) });
  await audit(cfg, null, "revoke_admin", "admin_profiles", user.id, { email });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] ?? "" : null; };
  try {
    const cfg = loadDbConfig(process.env);
    const site = (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/]+$/.test(site)) throw new AdminScriptError("SITE_URL must be the shop's origin");
    const email = arg("--email") ?? "";
    if (argv.includes("--revoke")) {
      await revokeAdmin(cfg, email);
      console.log(`${email}: admin access removed and sign-in blocked.`);
    } else if (argv.includes("--reset")) {
      const r = await resetAdmin(cfg, site, email);
      console.log(`${email}: authenticator removed (${r.factorsRemoved}). Send this one-time link to choose a new password:\n\n  ${r.link}\n`);
    } else {
      const r = await grantAdmin(cfg, site, email, (arg("--role") ?? "") as StaffRole, arg("--name"));
      console.log(`${email}: ${r.created ? "account created" : "existing account"}, role ${arg("--role")}.`);
      console.log(`Send this one-time link (valid about 1 hour) to choose a password, then set up an authenticator app at ${site}/admin/:\n\n  ${r.link}\n`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
