/*
 * Staff authentication for admin functions (PR 8, spec §4.3).
 *
 * Every admin function calls requireStaff() first. It accepts a request only
 * if ALL of these hold, otherwise it answers 401/403 and nothing else runs:
 *   1. a Bearer token that Supabase Auth itself accepts (GET /auth/v1/user):
 *      a forged, tampered, expired or signed-out session is rejected there;
 *   2. the session completed MFA (aal = aal2): no admin data below aal2;
 *   3. the user has an admin_profiles row with an allowed role, read fresh on
 *      every request, so removing a profile revokes access immediately.
 * The database enforces the same rules again (RLS: is_staff + aal2), and the
 * admin's own token is used for its data queries so RLS applies to them too.
 */
import type { DbConfig } from "./config.mts";
import { HttpError } from "./http.mts";

export type StaffRole = "owner" | "admin" | "support";
export const ALL_STAFF: readonly StaffRole[] = ["owner", "admin", "support"];

export interface Staff {
  userId: string;
  email: string;
  role: StaffRole;
  displayName: string | null;
  sessionId: string | null;
  token: string;
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function claims(token: string): Record<string, unknown> {
  try { return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>; } catch { return {}; }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer ([^\s]+)$/.exec(h);
  return m && m[1]!.length < 4096 && JWT.test(m[1]!) ? m[1]! : null;
}

export async function requireStaff(req: Request, cfg: DbConfig, roles: readonly StaffRole[] = ALL_STAFF): Promise<Staff> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthenticated");

  // 1. Supabase Auth verifies the signature, expiry and that the session still exists.
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, "unauthenticated");
  if (!res.ok) throw new Error(`auth check failed: HTTP ${res.status}`);
  const user = (await res.json()) as { id?: string; email?: string };
  const c = claims(token); // trustworthy now: Supabase Auth accepted this exact token
  if (!user.id || c.sub !== user.id || c.role !== "authenticated") throw new HttpError(401, "unauthenticated");

  // 2. MFA.
  if (c.aal !== "aal2") throw new HttpError(403, "mfa_required");

  // 3. Staff role, read fresh.
  const p = await fetch(`${cfg.supabaseUrl}/rest/v1/admin_profiles?user_id=eq.${user.id}&select=role,display_name`, {
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!p.ok) throw new Error(`profile lookup failed: HTTP ${p.status}`);
  const [profile] = (await p.json()) as Array<{ role: StaffRole; display_name: string | null }>;
  if (!profile) throw new HttpError(403, "not_staff");
  if (!roles.includes(profile.role)) throw new HttpError(403, "forbidden");

  return { userId: user.id, email: user.email ?? "", role: profile.role, displayName: profile.display_name, sessionId: typeof c.session_id === "string" ? c.session_id : null, token };
}

/* PostgREST as the staff member: RLS (is_staff + aal2) applies to the query. */
export async function asStaff<T>(cfg: DbConfig, staff: Staff, pathAndQuery: string): Promise<T> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: cfg.anonKey ?? cfg.serviceKey, Authorization: `Bearer ${staff.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${pathAndQuery.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* Append an admin action to the audit log (record_admin_action, service role). */
export async function audit(cfg: DbConfig, staff: Staff | null, action: string, entity: string, entityId: string, detail: Record<string, unknown> = {}): Promise<void> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/record_admin_action`, {
    method: "POST",
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_actor: staff?.userId ?? null, p_role: staff ? `admin:${staff.role}` : "script", p_action: action, p_entity: entity, p_entity_id: entityId, p_detail: detail }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`audit failed: HTTP ${res.status}`);
}
