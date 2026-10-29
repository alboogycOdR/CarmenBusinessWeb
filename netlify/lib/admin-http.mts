/* Shared edge for admin functions (PR 8): config, auth, errors, no-store JSON. */
import { ConfigError, loadDbConfig, type DbConfig } from "./config.mts";
import { requireStaff, type Staff, type StaffRole, ALL_STAFF } from "./auth.mts";
import { HttpError, json, log } from "./http.mts";

export interface AdminContext { cfg: DbConfig; staff: Staff; req: Request }

/* Wraps an admin handler: method check, same-origin for writes, requireStaff,
 * and uniform errors. Error bodies carry a short code only. */
export function adminRoute(
  methods: string[],
  roles: readonly StaffRole[],
  fn: (ctx: AdminContext) => Promise<Response>,
  env: Record<string, string | undefined> = process.env,
) {
  return async function handler(req: Request): Promise<Response> {
    if (!methods.includes(req.method)) return json(405, { error: "method_not_allowed" }, { Allow: methods.join(", ") });
    let cfg: DbConfig;
    try {
      cfg = loadDbConfig(env);
    } catch (e) {
      log("error", "admin_misconfigured", { problem: e instanceof ConfigError ? e.message : "unknown" });
      return json(503, { error: "unavailable" });
    }
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      const site = (env.SITE_URL ?? "").replace(/\/+$/, "");
      if (origin && site && origin !== site) return json(403, { error: "forbidden_origin" });
    }
    try {
      const staff = await requireStaff(req, cfg, roles);
      return await fn({ cfg, staff, req });
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 403 && e.code !== "mfa_required") log("warn", "admin_denied", { code: e.code, path: new URL(req.url).pathname });
        return json(e.status, { error: e.code }, e.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
      }
      log("error", "admin_failed", { message: e instanceof Error ? e.message : String(e), path: new URL(req.url).pathname });
      return json(500, { error: "unavailable" });
    }
  };
}

export { ALL_STAFF };
