/*
 * /api/admin/session  (PR 8)
 *   GET  → the signed-in staff member (email, role). Any staff role, aal2.
 *   POST → the same, and records the sign-in in the audit log. The admin page
 *          calls it once after MFA succeeds.
 */
import { audit } from "../lib/auth.mts";
import { adminRoute, ALL_STAFF } from "../lib/admin-http.mts";
import { json } from "../lib/http.mts";

export function createSessionHandler(env: Record<string, string | undefined> = process.env) {
  return adminRoute(["GET", "POST"], ALL_STAFF, async ({ cfg, staff, req }) => {
    if (req.method === "POST") {
      await audit(cfg, staff, "sign_in", "admin_session", staff.sessionId ?? staff.userId, { email: staff.email });
    }
    return json(200, { email: staff.email, role: staff.role, displayName: staff.displayName, mfa: true });
  }, env);
}

export default createSessionHandler();

export const config = {
  path: "/api/admin/session",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
