/*
 * Integration tests for payment confirmation (PR 4): the real ITN handler and
 * replay tool against the real local database. Only Payfast's network side is
 * replaced (its validate endpoint and DNS); every delivery is signed exactly as
 * Payfast signs it (algorithm pinned to Payfast's PHP code in payfast.test.mts).
 *
 * Requires the local stack (npm run db:start). Run with: npm run test:db
 */
import test from "node:test";
import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import checkout from "../netlify/functions/checkout.mts";
import orderStatus from "../netlify/functions/order-status.mts";
import { createItnHandler, config as itnConfig } from "../netlify/functions/payfast-itn.mts";
import { loadItnConfig } from "../netlify/lib/config.mts";
import type { ItnDeps } from "../netlify/lib/itn.mts";
import { itnParamString, phpUrlencode } from "../netlify/lib/payfast.mts";
import { replayEvent, ReplayError } from "../scripts/replay-event.mts";

function stack(): { url: string; service: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return { url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  return { url: s.API_URL, service: s.SERVICE_ROLE_KEY };
}
const DB = stack();
const SITE = "http://localhost:8080";
const PASS = "itn-test-passphrase-" + randomBytes(4).toString("hex");
const MERCHANT = "10000001";
const ENV = {
  SUPABASE_URL: DB.url, SUPABASE_SERVICE_ROLE_KEY: DB.service, SITE_URL: SITE,
  PAYFAST_MODE: "sandbox", PAYFAST_MERCHANT_ID: MERCHANT, PAYFAST_MERCHANT_KEY: "fakekey00000a", PAYFAST_PASSPHRASE: PASS,
};
Object.assign(process.env, ENV);

const PAYFAST_IP = "197.97.145.150"; // inside Payfast's published 197.97.145.144/28
const RUN = randomBytes(3).toString("hex");
let txnSeq = Number(BigInt("0x" + randomBytes(4).toString("hex")) % 900_000_000n) + 100_000_000;
const nextTxn = () => String(txnSeq++);
const email = (tag: string) => `${tag}-${RUN}-${randomBytes(3).toString("hex")}@example.com`;

/* Fake Payfast network: validate answers VALID unless told otherwise; DNS knows nothing. */
function fakeDeps(over: Partial<ItnDeps> = {}): ItnDeps & { validated: string[] } {
  const validated: string[] = [];
  return {
    validated,
    resolveHost: async () => [],
    validate: async (_mode, s) => { validated.push(s); return "VALID"; },
    ...over,
  };
}

async function admin(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${DB.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

interface Checkout { reference: string; accessKey: string; totalMinor: number; fields: Record<string, string> }
async function buy(slugs: string[], tag: string): Promise<Checkout> {
  const res = await checkout(new Request(`${SITE}/api/checkout`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: SITE },
    body: JSON.stringify({ items: slugs.map((id) => ({ id, qty: 1 })), email: email(tag), termsAccepted: true }),
  }));
  assert.strictEqual(res.status, 201, await res.clone().text());
  const b = JSON.parse(await res.text());
  return { reference: b.reference, accessKey: b.accessKey, totalMinor: b.totalMinor, fields: Object.fromEntries(b.payment.fields) };
}

/* The notification Payfast would send for a checkout, signed with `passphrase`. */
function itnFor(c: Checkout, o: { txn?: string; status?: string; amount?: string; merchant?: string; reference?: string; passphrase?: string } = {}): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    ["m_payment_id", o.reference ?? c.reference], ["pf_payment_id", o.txn ?? nextTxn()], ["payment_status", o.status ?? "COMPLETE"],
    ["item_name", c.fields.item_name ?? ""], ["item_description", c.fields.item_description ?? ""],
    ["amount_gross", o.amount ?? c.fields.amount ?? ""], ["amount_fee", "-4.60"], ["amount_net", "0.00"],
    ["custom_str1", ""], ["custom_str2", ""], ["custom_str3", ""], ["custom_str4", ""], ["custom_str5", ""],
    ["custom_int1", ""], ["custom_int2", ""], ["custom_int3", ""], ["custom_int4", ""], ["custom_int5", ""],
    ["name_first", "Thandi"], ["name_last", "O'Brien"], ["email_address", c.fields.email_address ?? ""], ["merchant_id", o.merchant ?? MERCHANT],
  ];
  const sig = createHash("md5").update(`${itnParamString(pairs, true)}&passphrase=${phpUrlencode(o.passphrase ?? PASS)}`).digest("hex");
  return [...pairs, ["signature", sig]];
}

const handlerWith = (deps: ItnDeps, env: Record<string, string> = ENV) => createItnHandler(deps, env);
/* ip: the connecting address Netlify reports; null = Netlify reported none. */
function deliver(handler: ReturnType<typeof createItnHandler>, pairs: Array<[string, string]> | string, ip: string | null = PAYFAST_IP, headers: Record<string, string> = {}) {
  const body = typeof pairs === "string" ? pairs : new URLSearchParams(pairs).toString();
  return handler(new Request(`${SITE}/api/payfast/itn`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body }), ip === null ? {} : { ip });
}

const orderOf = async (ref: string) => (await admin(`orders?reference=eq.${ref}&select=*`))[0];
const fulfilmentsOf = async (orderId: string) => admin(`fulfilments?order_id=eq.${orderId}&select=kind,status,asset_id&order=created_at`);
const emailsOf = async (orderId: string) => admin(`email_events?order_id=eq.${orderId}&select=template,to_email,status`);
const eventsFor = async (key: string) => admin(`payment_events?provider=eq.payfast&provider_event_id=eq.${encodeURIComponent(key)}&select=*`);

test("happy path: a verified COMPLETE ITN pays the order exactly once (spec §7 Checkout success)", async () => {
  const c = await buy(["signature-course"], "happy");
  const deps = fakeDeps();
  const pairs = itnFor(c);
  const txn = pairs.find(([k]) => k === "pf_payment_id")![1];
  const res = await deliver(handlerWith(deps), pairs);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), "OK");
  assert.strictEqual(res.headers.get("cache-control"), "no-store");

  // Check 4 was made with exactly the signed fields, without the signature or passphrase.
  assert.strictEqual(deps.validated.length, 1);
  assert.strictEqual(deps.validated[0], itnParamString(pairs, true));
  assert.ok(!deps.validated[0]!.includes("signature=") && !deps.validated[0]!.includes(PASS));

  const order = await orderOf(c.reference);
  assert.strictEqual(order.status, "paid");
  assert.strictEqual(order.provider_txn_id, txn);
  assert.ok(order.paid_at);
  const ful = await fulfilmentsOf(order.id);
  assert.deepStrictEqual(ful.map((f: any) => `${f.kind}/${f.status}`).sort(), ["external/queued", "file/queued"], "mixed delivery: link + file");
  assert.deepStrictEqual(await emailsOf(order.id), [{ template: "order_paid", to_email: c.fields.email_address, status: "queued" }]);
  const [ev] = await eventsFor(`${txn}:COMPLETE`);
  assert.strictEqual(ev.status, "processed");
  assert.strictEqual(ev.order_id, order.id);
  assert.strictEqual(ev.payload.source_ip, PAYFAST_IP);
  assert.deepStrictEqual(ev.payload.fields, pairs, "the delivery is stored as received, in order, for replay");
});

test("spec §7 Webhook replay: the same ITN three times → one paid order, one delivery set, one email", async () => {
  const c = await buy(["book-one"], "replay3");
  const pairs = itnFor(c);
  const h = handlerWith(fakeDeps());
  for (let i = 0; i < 3; i++) assert.strictEqual((await deliver(h, pairs)).status, 200, `delivery ${i + 1}`);
  const order = await orderOf(c.reference);
  assert.strictEqual(order.status, "paid");
  assert.strictEqual((await fulfilmentsOf(order.id)).length, 2, "PDF + EPUB, once");
  assert.strictEqual((await emailsOf(order.id)).length, 1);
  const events = await eventsFor(`${pairs[1]![1]}:COMPLETE`);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].attempts, 1, "duplicates are acknowledged, not reprocessed");
});

test("concurrent duplicate deliveries still give one fulfilment set (enforced by the database)", async () => {
  const c = await buy(["bundle"], "parallel");
  const pairs = itnFor(c);
  const h = handlerWith(fakeDeps());
  const results = await Promise.all(Array.from({ length: 6 }, () => deliver(h, pairs)));
  assert.deepStrictEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  const order = await orderOf(c.reference);
  assert.strictEqual(order.status, "paid");
  assert.strictEqual((await fulfilmentsOf(order.id)).length, 6, "bundle: every component asset exactly once");
  assert.strictEqual((await emailsOf(order.id)).length, 1);
  assert.strictEqual((await eventsFor(`${pairs[1]![1]}:COMPLETE`)).length, 1);
});

test("each of the four checks fails independently and leaves no paid order", async (t) => {
  const unpaid = async (ref: string) => {
    const o = await orderOf(ref);
    assert.strictEqual(o.status, "pending", "order still pending");
    assert.strictEqual((await fulfilmentsOf(o.id)).length, 0, "no fulfilment");
    assert.strictEqual((await emailsOf(o.id)).length, 0, "no email");
  };

  await t.test("1. bad signature → 400, stored under a throwaway key, never linked", async () => {
    const c = await buy(["book-two"], "sig");
    const pairs = itnFor(c, { passphrase: "not-the-passphrase" });
    const deps = fakeDeps();
    const res = await deliver(handlerWith(deps), pairs);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(await res.text(), "signature_mismatch");
    assert.strictEqual(deps.validated.length, 0, "nothing forged is sent to Payfast");
    await unpaid(c.reference);
    assert.strictEqual((await eventsFor(`${pairs[1]![1]}:COMPLETE`)).length, 0, "the real event key is not claimed");
    const rejected = await admin(`payment_events?provider_event_id=like.rejected:*&payload->fields->0->>1=eq.${c.reference}&select=status,error,order_id`);
    assert.deepStrictEqual(rejected, [{ status: "failed", error: "signature_mismatch", order_id: null }]);
    // The genuine notification for the same payment still works.
    // From anywhere else, a forgery is answered and logged but not stored.
    const before = (await admin("payment_events?provider_event_id=like.rejected:*&select=id")).length;
    const stranger = await deliver(handlerWith(fakeDeps()), itnFor(c, { passphrase: "guess" }), "203.0.113.50");
    assert.strictEqual(stranger.status, 400);
    assert.strictEqual((await admin("payment_events?provider_event_id=like.rejected:*&select=id")).length, before, "strangers cannot fill the events table");
    const genuine = itnFor(c, { txn: pairs[1]![1] });
    assert.strictEqual((await deliver(handlerWith(fakeDeps()), genuine)).status, 200);
    assert.strictEqual((await orderOf(c.reference)).status, "paid");
  });

  await t.test("2. not from Payfast's servers → 403 (Referer and X-Forwarded-For are ignored)", async () => {
    const c = await buy(["planner"], "ip");
    const deps = fakeDeps();
    const res = await deliver(handlerWith(deps), itnFor(c), "203.0.113.9", { Referer: "https://www.payfast.co.za/", "X-Forwarded-For": PAYFAST_IP });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(await res.text(), "source_ip_mismatch");
    assert.strictEqual(deps.validated.length, 0);
    await unpaid(c.reference);
    // An address of a host Payfast's reference code resolves is accepted.
    const viaDns = await deliver(handlerWith(fakeDeps({ resolveHost: async (h) => (h === "w1w.payfast.co.za" ? ["198.51.100.7"] : []) })), itnFor(c), "198.51.100.7");
    assert.strictEqual(viaDns.status, 200);
  });

  await t.test("2b. no connecting IP, or DNS down for an unlisted IP → 503 so Payfast retries", async () => {
    const c = await buy(["planner"], "ip2");
    assert.strictEqual((await deliver(handlerWith(fakeDeps()), itnFor(c), null)).status, 503);
    const dnsDown = fakeDeps({ resolveHost: async () => { throw new Error("SERVFAIL"); } });
    assert.strictEqual((await deliver(handlerWith(dnsDown), itnFor(c), "203.0.113.10")).status, 503);
    await unpaid(c.reference);
  });

  await t.test("3a. amount R0.01 off → stored failed, not paid", async () => {
    const c = await buy(["book-two"], "amount");
    for (const amount of ["198.99", "199.01"]) {
      const pairs = itnFor(c, { amount });
      const res = await deliver(handlerWith(fakeDeps()), pairs);
      assert.strictEqual(res.status, 200, "permanent: Payfast need not retry");
      assert.strictEqual(await res.text(), "amount_mismatch");
      const [ev] = await eventsFor(`${pairs[1]![1]}:COMPLETE`);
      assert.deepStrictEqual([ev.status, ev.error], ["failed", "amount_mismatch"]);
    }
    await unpaid(c.reference);
  });

  await t.test("3b. a foreign merchant_id → stored failed", async () => {
    const c = await buy(["book-two"], "merchant");
    const res = await deliver(handlerWith(fakeDeps()), itnFor(c, { merchant: "10009999" }));
    assert.strictEqual(await res.text(), "merchant_mismatch");
    await unpaid(c.reference);
  });

  await t.test("3c. an unknown reference → stored failed", async () => {
    const c = await buy(["book-two"], "unknownref");
    const res = await deliver(handlerWith(fakeDeps()), itnFor(c, { reference: "CBW-0000000000" }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "unknown_order");
    await unpaid(c.reference);
  });

  await t.test("4a. Payfast answers INVALID → stored failed", async () => {
    const c = await buy(["book-two"], "invalid");
    const res = await deliver(handlerWith(fakeDeps({ validate: async () => "INVALID" })), itnFor(c));
    assert.strictEqual(await res.text(), "server_validation_invalid");
    await unpaid(c.reference);
  });

  await t.test("4b. validate times out → 503; Payfast's retry then pays the order once", async () => {
    const c = await buy(["book-two"], "timeout");
    const pairs = itnFor(c);
    const down = await deliver(handlerWith(fakeDeps({ validate: async () => { throw new Error("timeout"); } })), pairs);
    assert.strictEqual(down.status, 503);
    assert.strictEqual(await down.text(), "server_validation_unavailable");
    await unpaid(c.reference);
    const retry = await deliver(handlerWith(fakeDeps()), pairs);
    assert.strictEqual(retry.status, 200);
    const order = await orderOf(c.reference);
    assert.strictEqual(order.status, "paid");
    assert.strictEqual((await emailsOf(order.id)).length, 1);
    const [ev] = await eventsFor(`${pairs[1]![1]}:COMPLETE`);
    assert.deepStrictEqual([ev.status, ev.error, ev.attempts], ["processed", null, 2]);
  });
});

test("a sandbox ITN never pays a live order, and a live deployment never pays a sandbox order", async () => {
  const c = await buy(["workbook"], "mode"); // created in sandbox mode
  const live = { ...ENV, PAYFAST_MODE: "live" };
  const deps = fakeDeps();
  const modes: string[] = [];
  deps.validate = async (mode) => { modes.push(mode); return "VALID"; };
  const res = await deliver(handlerWith(deps, live), itnFor(c));
  assert.strictEqual(await res.text(), "mode_mismatch");
  assert.deepStrictEqual(modes, ["live"], "a live deployment validates against www.payfast.co.za");
  assert.strictEqual((await orderOf(c.reference)).status, "pending");
});

test("CANCELLED is recorded and ignored; the order can still be paid", async () => {
  const c = await buy(["workbook"], "cancelled");
  const res = await deliver(handlerWith(fakeDeps()), itnFor(c, { status: "CANCELLED" }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await orderOf(c.reference)).status, "pending");
  assert.strictEqual((await deliver(handlerWith(fakeDeps()), itnFor(c))).status, 200);
  assert.strictEqual((await orderOf(c.reference)).status, "paid");
});

test("a second, different payment for a paid order is flagged for a refund, not applied", async () => {
  const c = await buy(["workbook"], "double");
  const first = itnFor(c);
  await deliver(handlerWith(fakeDeps()), first);
  const res = await deliver(handlerWith(fakeDeps()), itnFor(c));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), "paid_by_other_transaction");
  assert.strictEqual((await orderOf(c.reference)).provider_txn_id, first[1]![1]);
});

test("order status now lists what each item delivers, still only with the private key", async () => {
  const c = await buy(["masterclass", "book-two"], "status");
  await deliver(handlerWith(fakeDeps()), itnFor(c));
  const res = await orderStatus(new Request(`${SITE}/api/order-status?ref=${c.reference}&k=${c.accessKey}`));
  assert.strictEqual(res.status, 200);
  const b = JSON.parse(await res.text());
  assert.strictEqual(b.status, "paid");
  assert.deepStrictEqual(b.items.map((i: any) => [i.title, i.downloads, i.links, i.manual]).sort(), [
    ["Live Masterclass Replay with Q&A", 0, 0, 1],
    ["The Second Book: Stories and Lessons", 1, 0, 0],
  ].sort());
  assert.ok(!JSON.stringify(b).includes("example.com/masterclass") && !JSON.stringify(b).includes(".pdf"), "never a link or storage path");
  const wrong = await orderStatus(new Request(`${SITE}/api/order-status?ref=${c.reference}&k=${"A".repeat(43)}`));
  assert.strictEqual(wrong.status, 404);
});

test("replay tool: a failed event succeeds exactly once after the cause is fixed", async () => {
  const c = await buy(["book-one"], "replay");
  const pairs = itnFor(c);
  // The deployment had the wrong merchant id when the (single) sandbox ITN arrived.
  const res = await deliver(handlerWith(fakeDeps(), { ...ENV, PAYFAST_MERCHANT_ID: "10000002" }), pairs);
  assert.strictEqual(await res.text(), "merchant_mismatch");
  const [ev] = await eventsFor(`${pairs[1]![1]}:COMPLETE`);

  const cfg = loadItnConfig(ENV);
  const deps = fakeDeps();
  const r = await replayEvent(ev.id, cfg, deps);
  assert.strictEqual(r.outcome, "paid");
  assert.strictEqual(deps.validated.length, 1, "replay still asks Payfast to confirm");
  assert.strictEqual((await orderOf(c.reference)).status, "paid");
  await assert.rejects(replayEvent(ev.id, cfg, fakeDeps()), ReplayError, "an already processed event is not replayed");
  const order = await orderOf(c.reference);
  assert.strictEqual((await fulfilmentsOf(order.id)).length, 2);
  assert.strictEqual((await emailsOf(order.id)).length, 1);
});

test("replay tool: deliveries rejected while the passphrase was wrong are recovered under their real key", async () => {
  const c = await buy(["book-two"], "passfix");
  const pairs = itnFor(c);
  const res = await deliver(handlerWith(fakeDeps(), { ...ENV, PAYFAST_PASSPHRASE: "old-wrong-value" }), pairs);
  assert.strictEqual(res.status, 400);
  const [rejected] = await admin(`payment_events?provider_event_id=like.rejected:*&payload->fields->0->>1=eq.${c.reference}&select=id`);

  const cfg = loadItnConfig(ENV);
  await assert.rejects(replayEvent(rejected.id, { ...cfg, passphrase: "still-wrong" }, fakeDeps()), /signature does not verify/, "replay re-verifies the signature");
  const r = await replayEvent(rejected.id, cfg, fakeDeps());
  assert.strictEqual(r.outcome, "paid");
  assert.strictEqual(r.eventKey, `${pairs[1]![1]}:COMPLETE`);
  const [closed] = await admin(`payment_events?id=eq.${rejected.id}&select=status,error`);
  assert.deepStrictEqual(closed, { status: "ignored", error: `superseded by replay as ${r.eventKey}` });
  await assert.rejects(replayEvent(rejected.id, cfg, fakeDeps()), ReplayError, "and is not replayed twice");
});

test("replay tool: refuses what it cannot safely replay", async () => {
  const cfg = loadItnConfig(ENV);
  await assert.rejects(replayEvent("nope", cfg, fakeDeps()), ReplayError);
  await assert.rejects(replayEvent("00000000-0000-4000-8000-000000000000", cfg, fakeDeps()), /not found/);
  // Payfast must still confirm the stored data.
  const c = await buy(["planner"], "replayinvalid");
  const pairs = itnFor(c);
  await deliver(handlerWith(fakeDeps({ validate: async () => "INVALID" })), pairs);
  const [ev] = await eventsFor(`${pairs[1]![1]}:COMPLETE`);
  const r = await replayEvent(ev.id, cfg, fakeDeps({ validate: async () => "INVALID" }));
  assert.deepStrictEqual([r.outcome, r.error], ["failed", "server_validation_invalid"]);
  assert.strictEqual((await orderOf(c.reference)).status, "pending");
});

test("HTTP edge: method, media type, size, malformed bodies, misconfiguration", async () => {
  const h = handlerWith(fakeDeps());
  assert.strictEqual((await h(new Request(`${SITE}/api/payfast/itn`))).status, 405);
  assert.strictEqual((await h(new Request(`${SITE}/api/payfast/itn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status, 415);
  assert.strictEqual((await deliver(h, "a=" + "x".repeat(17 * 1024))).status, 413);
  assert.strictEqual((await deliver(h, "a=1&a=2")).status, 400, "duplicate fields");
  assert.strictEqual((await deliver(h, "")).status, 400);
  const c = await buy(["planner"], "edge");
  const noTxn = itnFor(c).map(([k, v]) => [k, k === "pf_payment_id" ? "abc" : v] as [string, string]);
  assert.strictEqual((await deliver(h, noTxn)).status, 400, "a notification without a usable pf_payment_id is rejected");
  for (const missing of ["PAYFAST_PASSPHRASE", "PAYFAST_MERCHANT_ID", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const env: Record<string, string> = { ...ENV };
    delete env[missing];
    const res = await deliver(handlerWith(fakeDeps(), env), itnFor(c));
    assert.strictEqual(res.status, 503, `${missing} missing: Payfast keeps retrying`);
    assert.strictEqual(await res.text(), "unavailable", "no detail leaked");
  }
  assert.strictEqual((await orderOf(c.reference)).status, "pending");
  assert.deepStrictEqual(itnConfig.path, "/api/payfast/itn", "matches notify_url sent at checkout");
  assert.ok(itnConfig.rateLimit.windowLimit > 0);
});
