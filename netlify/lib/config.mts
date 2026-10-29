/* Environment configuration for server functions. Fails closed: a missing or
 * malformed variable stops the request before any order is created. Error
 * messages name variables, never their values. */
import type { PayfastCredentials, PayfastMode } from "./payfast.mts";

export class ConfigError extends Error {}

export interface DbConfig {
  supabaseUrl: string;
  serviceKey: string;
  /* The public key; used as `apikey` when calling the API with a staff token. Optional. */
  anonKey?: string;
}

export interface CheckoutConfig extends DbConfig {
  siteUrl: string;
  brand: string;
  payfast: PayfastCredentials;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string, problems: string[]): string {
  const v = (env[name] ?? "").trim();
  if (!v) problems.push(`${name} is not set`);
  return v;
}

export function loadDbConfig(env: Env): DbConfig {
  const problems: string[] = [];
  const supabaseUrl = required(env, "SUPABASE_URL", problems).replace(/\/+$/, "");
  const serviceKey = required(env, "SUPABASE_SERVICE_ROLE_KEY", problems);
  if (supabaseUrl && !/^https?:\/\/[^\s]+$/.test(supabaseUrl)) problems.push("SUPABASE_URL is not a URL");
  if (problems.length) throw new ConfigError(problems.join("; "));
  const anonKey = (env.SUPABASE_ANON_KEY ?? "").trim();
  return { supabaseUrl, serviceKey, ...(anonKey ? { anonKey } : {}) };
}

export function loadCheckoutConfig(env: Env): CheckoutConfig {
  const problems: string[] = [];
  let db: DbConfig | null = null;
  try { db = loadDbConfig(env); } catch (e) { problems.push((e as Error).message); }

  const siteUrl = required(env, "SITE_URL", problems).replace(/\/+$/, "");
  const mode = required(env, "PAYFAST_MODE", problems);
  const merchantId = required(env, "PAYFAST_MERCHANT_ID", problems);
  const merchantKey = required(env, "PAYFAST_MERCHANT_KEY", problems);
  const passphrase = required(env, "PAYFAST_PASSPHRASE", problems);

  if (mode && mode !== "sandbox" && mode !== "live") problems.push("PAYFAST_MODE must be sandbox or live");
  if (merchantId && !/^\d{1,10}$/.test(merchantId)) problems.push("PAYFAST_MERCHANT_ID must be numeric");
  if (merchantKey && !/^[A-Za-z0-9]{6,40}$/.test(merchantKey)) problems.push("PAYFAST_MERCHANT_KEY has an unexpected format");
  if (siteUrl) {
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(siteUrl);
    if (!/^https:\/\/[^\s/]+$/.test(siteUrl) && !local) problems.push("SITE_URL must be an https origin");
    // Payfast must be able to reach notify_url; a live store cannot run on localhost.
    if (mode === "live" && local) problems.push("PAYFAST_MODE=live requires a public https SITE_URL");
  }
  if (problems.length || !db) throw new ConfigError(problems.join("; "));

  return {
    ...db,
    siteUrl,
    brand: (env.STORE_NAME ?? "").trim() || "Carmen",
    payfast: { mode: mode as "sandbox" | "live", merchantId, merchantKey, passphrase },
  };
}

export interface ItnConfig extends DbConfig {
  mode: PayfastMode;
  merchantId: string;
  passphrase: string;
}

/* What the ITN endpoint and the replay tool need. No site URL or merchant key:
 * a notification only has to be verified, never signed. */
export function loadItnConfig(env: Env): ItnConfig {
  const problems: string[] = [];
  let db: DbConfig | null = null;
  try { db = loadDbConfig(env); } catch (e) { problems.push((e as Error).message); }
  const mode = required(env, "PAYFAST_MODE", problems);
  const merchantId = required(env, "PAYFAST_MERCHANT_ID", problems);
  const passphrase = required(env, "PAYFAST_PASSPHRASE", problems);
  if (mode && mode !== "sandbox" && mode !== "live") problems.push("PAYFAST_MODE must be sandbox or live");
  if (merchantId && !/^\d{1,10}$/.test(merchantId)) problems.push("PAYFAST_MERCHANT_ID must be numeric");
  if (problems.length || !db) throw new ConfigError(problems.join("; "));
  return { ...db, mode: mode as PayfastMode, merchantId, passphrase };
}

export interface EmailConfig extends DbConfig {
  resendApiKey: string;
  from: string;
  replyTo: string | null;
  alertTo: string | null;
  siteUrl: string;
  brand: string;
  vatNumber: string | null;
}

const ADDRESS = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/* The outbox worker's settings. EMAIL_FROM is "Name <orders@domain>" or a bare
 * address on a domain verified in Resend. Optional: EMAIL_REPLY_TO (where buyer
 * replies go), ALERT_EMAIL_TO (failed-email alerts), VAT_NUMBER (D3). */
export function loadEmailConfig(env: Env): EmailConfig {
  const problems: string[] = [];
  let db: DbConfig | null = null;
  try { db = loadDbConfig(env); } catch (e) { problems.push((e as Error).message); }
  const resendApiKey = required(env, "RESEND_API_KEY", problems);
  const from = required(env, "EMAIL_FROM", problems);
  const siteUrl = required(env, "SITE_URL", problems).replace(/\/+$/, "");
  if (from && !(ADDRESS.test(from) || /^[^<>]{1,80}<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/.test(from))) problems.push("EMAIL_FROM must be an address or 'Name <address>'");
  const opt = (name: string) => {
    const v = (env[name] ?? "").trim();
    if (v && !ADDRESS.test(v)) problems.push(`${name} must be an email address`);
    return v || null;
  };
  const replyTo = opt("EMAIL_REPLY_TO");
  const alertTo = opt("ALERT_EMAIL_TO");
  if (siteUrl && !/^https?:\/\/[^\s/]+$/.test(siteUrl)) problems.push("SITE_URL must be an origin");
  if (problems.length || !db) throw new ConfigError(problems.join("; "));
  return {
    ...db, resendApiKey, from, replyTo, alertTo, siteUrl,
    brand: (env.STORE_NAME ?? "").trim() || "Carmen",
    vatNumber: (env.VAT_NUMBER ?? "").trim() || null,
  };
}
