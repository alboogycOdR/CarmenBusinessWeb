/*
 * Re-process a stored Payfast notification (PR 4; the admin button in PR 10
 * calls the same code).
 *
 *   node scripts/replay-event.mts <payment_event id>
 *
 * Needs the same environment as the ITN function: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, PAYFAST_MODE, PAYFAST_MERCHANT_ID, PAYFAST_PASSPHRASE.
 *
 * Use it after fixing the cause of a failed event (a wrong passphrase or
 * merchant id, Payfast's validate endpoint down). The Payfast sandbox sends
 * each ITN once, so this is also how a missed sandbox notification is recovered.
 * Safety: the stored fields must still carry a valid signature AND Payfast's
 * server must still confirm them (VALID). Only the source-IP check is skipped,
 * because the payload is no longer an inbound connection. Replaying an event
 * that was already processed is a no-op, so running this twice is harmless.
 */
import { pathToFileURL } from "node:url";
import { ConfigError, loadItnConfig, type ItnConfig } from "../netlify/lib/config.mts";
import { defaultDeps, processItn, type ItnDeps, type ItnResult } from "../netlify/lib/itn.mts";
import { verifyItnSignature } from "../netlify/lib/payfast.mts";

interface StoredEvent {
  id: string;
  provider: string;
  provider_event_id: string;
  status: string;
  error: string | null;
  payload: { fields?: unknown };
}

export class ReplayError extends Error {}

async function rest(cfg: ItnConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`,
      "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function storedFields(event: StoredEvent): Array<[string, string]> {
  const fields = event.payload?.fields;
  if (!Array.isArray(fields) || !fields.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "string"))) {
    throw new ReplayError("event payload has no Payfast fields to replay");
  }
  return fields as Array<[string, string]>;
}

export async function replayEvent(eventId: string, cfg: ItnConfig, deps: ItnDeps): Promise<ItnResult> {
  if (!/^[0-9a-f-]{36}$/.test(eventId)) throw new ReplayError("not an event id");
  const rows = (await rest(cfg, `payment_events?id=eq.${eventId}&select=id,provider,provider_event_id,status,error,payload`)) as StoredEvent[];
  const event = rows[0];
  if (!event) throw new ReplayError("event not found");
  if (event.provider !== "payfast") throw new ReplayError(`not a Payfast event (${event.provider})`);
  if (event.status === "processed" || event.status === "ignored") throw new ReplayError(`event is already ${event.status}; nothing to replay`);

  const fields = storedFields(event);
  // Check before processing, so a failed replay leaves no new rejected row behind.
  if (!verifyItnSignature(fields, cfg.passphrase).ok) throw new ReplayError("signature does not verify with the configured passphrase");
  const result = await processItn(fields, null, cfg, deps, { skipSourceCheck: true });

  // A delivery rejected under a throwaway key (e.g. while the passphrase was
  // wrong) is processed under its real key; close the old row so it is not
  // replayed again.
  if (event.provider_event_id.startsWith("rejected:") && result.outcome !== "rejected" && result.outcome !== "failed") {
    await rest(cfg, `payment_events?id=eq.${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ignored", error: `superseded by replay as ${result.eventKey}` }),
    });
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const id = process.argv[2] ?? "";
  try {
    const cfg = loadItnConfig(process.env);
    const r = await replayEvent(id, cfg, defaultDeps());
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.outcome === "failed" || r.outcome === "rejected" ? 1 : 0);
  } catch (e) {
    console.error(e instanceof ReplayError || e instanceof ConfigError ? `replay refused: ${e.message}` : e);
    process.exit(2);
  }
}
