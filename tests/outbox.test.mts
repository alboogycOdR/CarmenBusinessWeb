/*
 * Integration tests for email delivery (PR 6): the real outbox worker, ITN
 * handler and download function against the real database and storage. Only
 * Resend is replaced by a recorder that can be told to fail.
 *
 * Requires the local stack (npm run db:start). Run with: npm run test:db
 */
import test from "node:test";
import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import checkout from "../netlify/functions/checkout.mts";
import { createDownloadHandler } from "../netlify/functions/download.mts";
import { createItnHandler } from "../netlify/functions/payfast-itn.mts";
import sendEmails, { config as sendEmailsConfig } from "../netlify/functions/send-emails.mts";
import { ConfigError, loadEmailConfig } from "../netlify/lib/config.mts";
import { runOutbox, type OutboxDeps } from "../netlify/lib/outbox.mts";
import { itnParamString, phpUrlencode } from "../netlify/lib/payfast.mts";
import { SendError, type OutgoingEmail } from "../netlify/lib/resend.mts";
import { grantManualAccess, manualAccessFor } from "../scripts/grant-manual-access.mts";

function stack(): { url: string; service: string } {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return { url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const s = JSON.parse(out.slice(out.indexOf("{")));
  return { url: s.API_URL, service: s.SERVICE_ROLE_KEY };
}
const DB = stack();
const SITE = "http://localhost:8080";
const PASS = "mail-test-passphrase-" + randomBytes(4).toString("hex");
const ENV = {
  SUPABASE_URL: DB.url, SUPABASE_SERVICE_ROLE_KEY: DB.service, SITE_URL: SITE, STORE_NAME: "Carmen",
  PAYFAST_MODE: "sandbox", PAYFAST_MERCHANT_ID: "10000001", PAYFAST_MERCHANT_KEY: "fakekey00000a", PAYFAST_PASSPHRASE: PASS,
  RESEND_API_KEY: "re_test_not_real", EMAIL_FROM: "Carmen <orders@example.com>", EMAIL_REPLY_TO: "hello@example.com", ALERT_EMAIL_TO: "owner@example.com",
};
Object.assign(process.env, ENV);
const CFG = loadEmailConfig(ENV);
const RUN = randomBytes(3).toString("hex");
let txn = Number(BigInt("0x" + randomBytes(4).toString("hex")) % 700_000_000n) + 100_000_000;

/* A Resend stand-in: records every message; `fail` decides per call. */
function recorder(fail: (msg: OutgoingEmail, n: number) => SendError | null = () => null, delayMs = 0): OutboxDeps & { sent: OutgoingEmail[]; calls: number } {
  const r = {
    sent: [] as OutgoingEmail[], calls: 0,
    async send(msg: OutgoingEmail) {
      r.calls++;
      if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
      const err = fail(msg, r.calls);
      if (err) throw err;
      r.sent.push(msg);
      return { id: `re_${randomBytes(6).toString("hex")}` };
    },
  };
  return r;
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

/* Checkout + signed ITN through the real handler. `mail` receives the inline send. */
async function buyAndPay(slugs: string[], tag: string, mail: OutboxDeps | null): Promise<{ reference: string; id: string; email: string }> {
  const email = `${tag}-${RUN}@example.com`;
  const res = await checkout(new Request(`${SITE}/api/checkout`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: SITE },
    body: JSON.stringify({ items: slugs.map((id) => ({ id, qty: 1 })), email, termsAccepted: true }),
  }));
  assert.strictEqual(res.status, 201);
  const b = JSON.parse(await res.text());
  const f = Object.fromEntries(b.payment.fields) as Record<string, string>;
  const pairs: Array<[string, string]> = [["m_payment_id", b.reference], ["pf_payment_id", String(txn++)], ["payment_status", "COMPLETE"],
    ["item_name", f.item_name!], ["amount_gross", f.amount!], ["merchant_id", "10000001"]];
  const sig = createHash("md5").update(`${itnParamString(pairs, true)}&passphrase=${phpUrlencode(PASS)}`).digest("hex");
  // Without email settings the ITN cannot send inline: the worker does it later.
  const env = mail ? ENV : { ...ENV, RESEND_API_KEY: "" };
  const itn = createItnHandler({ resolveHost: async () => [], validate: async () => "VALID" }, env, mail ?? undefined);
  const paid = await itn(new Request(`${SITE}/api/payfast/itn`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams([...pairs, ["signature", sig]]).toString(),
  }), { ip: "197.97.145.150" });
  assert.strictEqual(paid.status, 200);
  const [order] = await admin(`orders?reference=eq.${b.reference}&select=id,status`);
  assert.strictEqual(order.status, "paid");
  return { reference: b.reference, id: order.id, email };
}

test.before(async () => {
  for (const p of ["book-one/the-first-book.pdf", "book-one/the-first-book.epub"]) {
    const res = await fetch(`${DB.url}/storage/v1/object/product-files/${p}`, {
      method: "POST", body: Buffer.from(`%PDF-1.4 fixture ${p}`),
      headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": p.endsWith(".epub") ? "application/epub+zip" : "application/pdf", "x-upsert": "true" },
    });
    assert.ok(res.ok, `upload ${p}`);
  }
});

const mailsOf = (orderId: string) => admin(`email_events?order_id=eq.${orderId}&select=*&order=created_at`);
const linksIn = (msg: OutgoingEmail) => [...msg.text.matchAll(/https?:\/\/\S+\/api\/download\?t=([A-Za-z0-9_-]{43})/g)].map((m) => m[1]!);
const due = (id: string) => admin(`email_events?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }) });

test("spec §7 Mixed delivery: a book and an external course arrive in ONE email, sent as soon as payment is confirmed", async () => {
  const mail = recorder();
  const o = await buyAndPay(["book-one", "starter-course"], "mixed", mail);
  assert.strictEqual(mail.sent.length, 1, "sent inline by the ITN, no waiting for the scheduler");
  const m = mail.sent[0]!;
  assert.strictEqual(m.to, o.email);
  assert.strictEqual(m.from, "Carmen <orders@example.com>");
  assert.strictEqual(m.replyTo, "hello@example.com");
  assert.match(m.subject, new RegExp(`order ${o.reference}: receipt and access`));
  assert.strictEqual(linksIn(m).length, 2, "two download links (PDF + EPUB)");
  assert.ok(m.text.includes("https://courses.example.com/starter"), "and the course link");
  assert.match(m.text, /Use the enrolment link within 30 days\./, "with its instructions");

  const [row] = await mailsOf(o.id);
  assert.strictEqual(row.status, "sent");
  assert.match(row.provider_message_id, /^re_/);
  const ful = await admin(`fulfilments?order_id=eq.${o.id}&select=status,delivered_at`);
  assert.deepStrictEqual([...new Set(ful.map((f: any) => f.status))], ["delivered"]);

  // The emailed link is a working download.
  const download = createDownloadHandler(ENV);
  const press = await download(new Request(`${SITE}/api/download?t=${linksIn(m)[0]}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `t=${linksIn(m)[0]}`,
  }));
  assert.strictEqual(press.status, 303);
});

test("bundles deliver the child items' files; manual access is truthful and pending", async () => {
  const mail = recorder();
  const o = await buyAndPay(["bundle", "masterclass"], "bundle", mail);
  const m = mail.sent[0]!;
  assert.strictEqual(linksIn(m).length, 5, "bundle: workbook, book one PDF + EPUB, book two, companion workbook");
  assert.ok(m.text.includes("https://courses.example.com/signature"), "the bundled course link");
  assert.match(m.text, /Masterclass replay access: we set this up for you by hand, within 1 business day\. We'll email you as soon as it's ready/);
  assert.ok(!m.text.includes("courses.example.com/masterclass"), "no manual link before access is granted");
  const manual = await manualAccessFor(CFG, o.reference);
  assert.deepStrictEqual(manual.map((w) => [w.status, w.label]), [["action_required", "Masterclass replay access"]]);

  // Staff grant it: the "access is ready" email goes out with the link.
  const granted = await grantManualAccess(CFG, manual[0]!.id);
  assert.strictEqual(granted.outcome, "granted");
  const ready = recorder();
  const results = await runOutbox(CFG, ready, { orderId: o.id });
  assert.deepStrictEqual(results.map((r) => [r.template, r.outcome]), [["manual_access_ready", "sent"]]);
  assert.match(ready.sent[0]!.subject, /Your access to Live Masterclass Replay with Q&A is ready/);
  assert.ok(ready.sent[0]!.text.includes("https://courses.example.com/masterclass"));
  assert.strictEqual((await grantManualAccess(CFG, manual[0]!.id)).outcome, "already_granted");
  assert.deepStrictEqual(await runOutbox(CFG, recorder(), { orderId: o.id }), [], "nothing is sent twice");
});

test("spec §7 Email outage: the order stays paid, the email waits, and a later run sends it once", async () => {
  const down = recorder(() => new SendError("resend 503 application_error", 503, false, null));
  const o = await buyAndPay(["book-two"], "outage", down);
  assert.strictEqual(down.calls, 1, "tried inline");
  let [row] = await mailsOf(o.id);
  assert.strictEqual(row.status, "queued");
  assert.strictEqual(row.attempts, 1);
  assert.match(row.last_error, /resend 503/);
  const wait = (Date.parse(row.next_attempt_at) - Date.now()) / 1000;
  assert.ok(wait > 50 && wait <= 61, `retry in about a minute (got ${wait}s)`);
  assert.strictEqual((await admin(`orders?id=eq.${o.id}&select=status`))[0].status, "paid", "payment unaffected");

  assert.deepStrictEqual(await runOutbox(CFG, recorder(), { orderId: o.id }), [], "not due yet: the scheduler leaves it alone");
  await due(row.id);
  const up = recorder();
  const results = await runOutbox(CFG, up, { orderId: o.id });
  assert.deepStrictEqual(results.map((r) => r.outcome), ["sent"]);
  assert.strictEqual(up.sent.length, 1);
  [row] = await mailsOf(o.id);
  assert.deepStrictEqual([row.status, row.attempts], ["sent", 2]);
  // The retry issued fresh links; links from the failed attempt were never revoked.
  const tokens = await admin(`delivery_tokens?select=revoked_at,fulfilments!inner(order_id)&fulfilments.order_id=eq.${o.id}`);
  assert.strictEqual(tokens.length, 2, "one link per attempt");
  assert.ok(tokens.every((t: any) => t.revoked_at === null), "no buyer is left holding a dead link");
  await due(row.id);
  assert.deepStrictEqual(await runOutbox(CFG, recorder(), { orderId: o.id }), [], "a sent email is never sent again");
});

test("rate limits honour Retry-After; permanent rejections alert the owner once", async () => {
  const limited = recorder(() => new SendError("resend 429 daily_quota_exceeded", 429, false, 3600));
  const o = await buyAndPay(["planner"], "quota", limited);
  const [row] = await mailsOf(o.id);
  assert.ok(Date.parse(row.next_attempt_at) - Date.now() > 3500 * 1000, "waits as long as Resend asked");

  const rejected = recorder(() => new SendError("resend 422 validation_error: Invalid `to` field", 422, true, null));
  const o2 = await buyAndPay(["planner"], "rejected", rejected);
  const rows = await mailsOf(o2.id);
  assert.deepStrictEqual(rows.map((r: any) => [r.template, r.status]), [["order_paid", "failed"], ["admin_alert", "queued"]]);
  assert.strictEqual(rows[1].to_email, "owner@example.com");
  const alert = recorder();
  await runOutbox(CFG, alert, { orderId: o2.id });
  assert.strictEqual(alert.sent.length, 1);
  assert.match(alert.sent[0]!.subject, new RegExp(`Email to a buyer failed for order ${o2.reference}`));
  assert.match(alert.sent[0]!.text, /Invalid `to` field/);
  assert.match(alert.sent[0]!.text, new RegExp(`order_paid to ${o2.email}`));
});

test("overlapping workers never send the same email twice", async () => {
  const orders: Array<{ reference: string; id: string; email: string }> = [];
  for (let i = 0; i < 4; i++) orders.push(await buyAndPay(["workbook"], `overlap${i}`, null));
  const ids = new Set(orders.map((o) => o.id));
  const slow = recorder(() => null, 150);
  // Six concurrent runs over the same four due emails.
  const runs = await Promise.all(Array.from({ length: 6 }, () => runOutbox(CFG, slow, { limit: 50 })));
  const mine = slow.sent.filter((m) => orders.some((o) => o.email === m.to));
  assert.strictEqual(mine.length, 4, "each email exactly once");
  assert.strictEqual(new Set(mine.map((m) => m.to)).size, 4);
  for (const id of ids) assert.strictEqual((await mailsOf(id))[0].status, "sent");
  assert.ok(runs.flat().length >= 4);
});

test("a crashed worker's email comes back after its lease, and an order refunded before sending gets no links", async () => {
  const o = await buyAndPay(["book-two"], "crash", null);
  const [row] = await mailsOf(o.id);
  // Claim without finishing (the function died mid-run).
  const claimed = (await (await fetch(`${DB.url}/rest/v1/rpc/claim_due_emails`, {
    method: "POST", headers: { apikey: DB.service, Authorization: `Bearer ${DB.service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: 5, p_order_id: o.id }),
  })).json()) as unknown[];
  assert.strictEqual(claimed.length, 1);
  assert.deepStrictEqual(await runOutbox(CFG, recorder(), { orderId: o.id }), [], "leased: not taken again yet");
  await due(row.id);
  const later = recorder();
  assert.deepStrictEqual((await runOutbox(CFG, later, { orderId: o.id })).map((r) => r.outcome), ["sent"]);
  assert.strictEqual((await mailsOf(o.id))[0].attempts, 2);

  const o2 = await buyAndPay(["book-two"], "refunded", null);
  await admin(`orders?id=eq.${o2.id}`, { method: "PATCH", body: JSON.stringify({ status: "disputed" }) });
  const none = recorder();
  const r = await runOutbox(CFG, none, { orderId: o2.id });
  assert.deepStrictEqual(r.map((x) => x.outcome), ["failed"]);
  assert.strictEqual(none.calls, 0, "nothing sent");
  assert.strictEqual((await admin(`delivery_tokens?select=id,fulfilments!inner(order_id)&fulfilments.order_id=eq.${o2.id}`)).length, 0, "no links issued");
});

test("configuration: the scheduled worker fails closed and leaves emails queued", async () => {
  const o = await buyAndPay(["book-two"], "noconfig", null);
  const saved = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "";
  try {
    assert.strictEqual((await sendEmails()).status, 500);
  } finally {
    process.env.RESEND_API_KEY = saved;
  }
  assert.strictEqual((await mailsOf(o.id))[0].status, "queued");
  assert.strictEqual(sendEmailsConfig.schedule, "*/2 * * * *");
  assert.throws(() => loadEmailConfig({ ...ENV, EMAIL_FROM: "not an address" }), ConfigError);
  assert.throws(() => loadEmailConfig({ ...ENV, ALERT_EMAIL_TO: "nope" }), ConfigError);
  assert.doesNotThrow(() => loadEmailConfig({ ...ENV, EMAIL_FROM: "orders@example.com", EMAIL_REPLY_TO: "", ALERT_EMAIL_TO: "" }));
});
