/*
 * GET /api/admin/audit?limit=50  (PR 8): recent audit log, owner and admin only.
 * The query runs with the staff member's own token, so the database's RLS
 * (owner/admin at aal2) must agree as well. Names come from admin_profiles.
 */
import { asStaff } from "../lib/auth.mts";
import { adminRoute } from "../lib/admin-http.mts";
import { json } from "../lib/http.mts";

/* Plain-English labels for the activity list. Unknown entries fall back to the raw names. */
const ACTIONS: Record<string, string> = {
  sign_in: "Signed in to the admin", grant_admin: "Staff access granted or changed", revoke_admin: "Staff access removed",
  reset_admin: "Staff sign-in reset (new password and authenticator)",
};
const ROWS: Record<string, [string, string, string]> = { // entity: [INSERT, UPDATE, DELETE]
  orders: ["New order started", "Order paid or changed", "Order removed"],
  fulfilments: ["Delivery prepared", "Delivery updated", "Delivery removed"],
  delivery_tokens: ["Download link issued", "Download link used or revoked", "Download link removed"],
  admin_profiles: ["Staff profile added", "Staff profile changed", "Staff profile removed"],
  products: ["Product added", "Product changed", "Product removed"],
  product_assets: ["Product file or link added", "Product file or link changed", "Product file or link removed"],
  coupons: ["Coupon added", "Coupon changed", "Coupon removed"],
  categories: ["Category added", "Category changed", "Category removed"],
};
export function describe(action: string, entity: string, detail: string | null): string {
  if (action === "ACTION") return ACTIONS[detail ?? ""] ?? (detail ?? "Action");
  const i = ["INSERT", "UPDATE", "DELETE"].indexOf(action);
  return ROWS[entity]?.[i] ?? `${action.toLowerCase()} ${entity}`;
}

interface Row { id: number; at: string; actor: string | null; actor_role: string; action: string; entity: string; entity_id: string | null; after: Record<string, unknown> | null }

export function createAuditHandler(env: Record<string, string | undefined> = process.env) {
  return adminRoute(["GET"], ["owner", "admin"], async ({ cfg, staff, req }) => {
    const n = Number(new URL(req.url).searchParams.get("limit") ?? "50");
    const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 50;
    const rows = await asStaff<Row[]>(cfg, staff, `audit_log?select=id,at,actor,actor_role,action,entity,entity_id,after&order=id.desc&limit=${limit}`);
    const actors = [...new Set(rows.map((r) => r.actor).filter((a): a is string => !!a))];
    const names = new Map<string, string>();
    if (actors.length) {
      const profiles = await asStaff<Array<{ user_id: string; display_name: string | null; role: string }>>(cfg, staff,
        `admin_profiles?select=user_id,display_name,role&user_id=in.(${actors.join(",")})`);
      for (const p of profiles) names.set(p.user_id, p.display_name ?? p.role);
    }
    return json(200, {
      entries: rows.map((r) => ({
        id: r.id, at: r.at,
        who: r.actor ? names.get(r.actor) ?? "staff" : r.actor_role === "script" ? "owner script" : "system",
        // ACTION rows name the action; row changes are INSERT/UPDATE/DELETE on a table.
        what: r.action === "ACTION" ? String(r.after?.action ?? "action") : `${r.action.toLowerCase()} ${r.entity}`,
        label: describe(r.action, r.entity, r.action === "ACTION" ? String(r.after?.action ?? "") : null),
        entity: r.entity, entityId: r.entity_id,
      })),
    });
  }, env);
}

export default createAuditHandler();

export const config = {
  path: "/api/admin/audit",
  method: ["GET"],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
