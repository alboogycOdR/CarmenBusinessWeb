/* Supabase Storage, server side only (PR 5, ADR-0005). The bucket is private;
 * the service role signs short-lived URLs for a single object. */
import type { DbConfig } from "./config.mts";

export const PRODUCT_BUCKET = "product-files";
export const SIGNED_URL_TTL_SECONDS = 60;

function objectPath(path: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.includes("..") || path.startsWith("/")) throw new Error("invalid storage path");
  return path.split("/").map(encodeURIComponent).join("/");
}

/* A URL that serves one object as an attachment for `ttlSeconds`. */
export async function signedDownloadUrl(cfg: DbConfig, path: string, filename: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const res = await fetch(`${cfg.supabaseUrl}/storage/v1/object/sign/${PRODUCT_BUCKET}/${objectPath(path)}`, {
    method: "POST",
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: ttlSeconds }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await res.json().catch(() => ({}))) as { signedURL?: string; message?: string };
  if (!res.ok || typeof body.signedURL !== "string" || !body.signedURL.startsWith("/object/sign/")) {
    throw new Error(`sign failed: HTTP ${res.status} ${body.message ?? ""}`.trim());
  }
  return `${cfg.supabaseUrl}/storage/v1${body.signedURL}&download=${encodeURIComponent(filename)}`;
}
