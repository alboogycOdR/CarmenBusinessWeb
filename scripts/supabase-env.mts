/*
 * Prints the running local Supabase stack's connection settings as KEY=value
 * lines, the same variables Netlify provides in deployed environments:
 *
 *   node scripts/supabase-env.mts >> "$GITHUB_ENV"     # CI
 *
 * Only for the local/CI stack, whose keys are Supabase's public demo keys.
 */
import { execFileSync } from "node:child_process";

const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const status = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
for (const [env, key] of [["SUPABASE_URL", "API_URL"], ["SUPABASE_ANON_KEY", "ANON_KEY"], ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"]] as const) {
  const value = status[key];
  if (!value) throw new Error(`supabase status did not report ${key}; is the stack running (npm run db:start)?`);
  if (/[\r\n]/.test(value)) throw new Error(`${key} contains a line break`);
  console.log(`${env}=${value}`);
}
