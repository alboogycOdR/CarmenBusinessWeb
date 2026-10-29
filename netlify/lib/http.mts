/* HTTP helpers shared by the functions. */

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/* Read a small JSON object body, rejecting oversized or non-JSON requests. */
export async function readJson(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "unsupported_media_type");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "payload_too_large");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > maxBytes) throw new HttpError(413, "payload_too_large");
  let body: unknown;
  try { body = JSON.parse(buf.toString("utf8")); } catch { throw new HttpError(400, "invalid_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_request");
  return body as Record<string, unknown>;
}

/* Structured log line; never pass emails, keys or tokens in `fields`. */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}
