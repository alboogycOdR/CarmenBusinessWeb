/* Email templates and the Resend adapter (PR 6). No database, no network.
 * The plain-text bodies are pinned by snapshots (tests/fixtures/email/*.txt):
 * wording promises (download limits, manual-access timing) change only on purpose.
 * Update after an intended change with: UPDATE_SNAPSHOTS=1 node --test tests/email.test.mts */
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderOrderPaid, saDate, zar, type EmailContext } from "../netlify/lib/email-templates.mts";
import { classify, SendError, sendViaResend, type OutgoingEmail } from "../netlify/lib/resend.mts";
import { previews, SAMPLE, SAMPLE_BRAND } from "../scripts/preview-email.mts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(here, "fixtures/email");

test("text bodies match the reviewed snapshots", () => {
  for (const [name, r] of Object.entries(previews())) {
    const file = path.join(SNAP, `${name}.txt`);
    const actual = `Subject: ${r.subject}\n\n${r.text}\n`;
    if (process.env.UPDATE_SNAPSHOTS) { fs.mkdirSync(SNAP, { recursive: true }); fs.writeFileSync(file, actual); }
    assert.strictEqual(actual, fs.readFileSync(file, "utf8"), `${name} changed; review it, then UPDATE_SNAPSHOTS=1`);
  }
});

test("money and dates are formatted the South African way (D17)", () => {
  assert.strictEqual(zar(199700), "R1 997.00");
  assert.strictEqual(zar(1234567890), "R12 345 678.90");
  assert.strictEqual(zar(500), "R5.00");
  assert.strictEqual(zar(7), "R0.07");
  assert.strictEqual(zar(-29960), "-R299.60");
  assert.strictEqual(saDate("2026-10-29T22:30:00Z"), "30 October 2026", "Johannesburg time");
  assert.strictEqual(saDate(null), "");
});

test("mixed delivery: one email carries the downloads and the course link", () => {
  const r = previews().order_paid;
  assert.match(r.subject, /^Your Carmen order CBW-7K2M9QX4TB: receipt and access$/);
  for (const s of ["https://shop.example.com/api/download?t=SAMPLE-f2", "https://shop.example.com/api/download?t=SAMPLE-f4",
    "https://shop.example.com/api/download?t=SAMPLE-f5", "https://courses.example.com/signature"]) {
    assert.ok(r.html.includes(`href="${s}"`), `html links ${s}`);
    assert.ok(r.text.includes(s), `text links ${s}`);
  }
  assert.ok(!r.html.includes("courses.example.com/masterclass"), "manual access is NOT linked before staff grant it");
  assert.match(r.text, /we set this up for you by hand, within 1 business day/, "truthful manual timing (spec §4.2)");
  assert.match(r.text, /up to 5 downloads each/);
  assert.match(r.text, /Total paid: R2 696\.40/);
  assert.doesNotMatch(r.html + r.text, /newsletter|unsubscribe|% off|sale/i, "no marketing in a purchase email (§4.3)");
});

test("database text is escaped; only safe links are rendered", () => {
  const evil: EmailContext = structuredClone(SAMPLE);
  evil.items[0]!.title = `<script>alert(1)</script> "Course"`;
  evil.items[0]!.deliveries[0]!.label = `<img src=x onerror=alert(2)>`;
  evil.items[0]!.deliveries[0]!.instructions = `</p><a href="javascript:alert(3)">click</a>`;
  evil.order!.coupon_code = `<b>X</b>`;
  const r = renderOrderPaid(evil, new Map(), SAMPLE_BRAND);
  assert.ok(!/<script|<img src=x|<a href="javascript|<b>X/.test(r.html), "nothing from the database becomes markup");
  assert.match(r.html, /&#60;script&#62;alert\(1\)&#60;\/script&#62;/);
  assert.match(r.html, /please contact us and we'll send you this file/, "a file without a link says so instead of linking nowhere");
});

test("VAT number appears only when configured (D3 pending)", () => {
  assert.doesNotMatch(previews().order_paid.text, /VAT/);
  const r = renderOrderPaid(SAMPLE, new Map(), { ...SAMPLE_BRAND, vatNumber: "4123456789" });
  assert.match(r.text, /VAT registration number: 4123456789\. Prices include VAT\./);
});

test("reply wording follows whether a reply-to address is configured", () => {
  assert.match(previews().order_paid.text, /Reply to this email or contact us at/);
  const r = renderOrderPaid(SAMPLE, new Map(), { ...SAMPLE_BRAND, replyTo: null });
  assert.match(r.text, /Questions, or trouble accessing anything\? Contact us at https:\/\/shop\.example\.com\/contact\.html/);
});

test("Resend errors are classified so retries only happen when they can succeed", () => {
  assert.strictEqual(classify(422), true);
  assert.strictEqual(classify(400), true);
  for (const s of [401, 403, 409, 429, 500, 502, 503]) assert.strictEqual(classify(s), false, String(s));
});

test("Resend adapter: request shape, success, and failure classification", async (t) => {
  const real = globalThis.fetch;
  const msg: OutgoingEmail = { from: "Carmen <orders@example.com>", to: "buyer@example.com", replyTo: "hello@example.com", subject: "S", html: "<p>h</p>", text: "t", tags: { template: "order_paid" } };
  let seen: { url: string; init: RequestInit } | null = null;
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(body), { status, headers }); }) as typeof fetch;
  };
  t.after(() => { globalThis.fetch = real; });

  respond(200, { id: "re_123" });
  assert.deepStrictEqual(await sendViaResend("re_key", msg), { id: "re_123" });
  assert.strictEqual(seen!.url, "https://api.resend.com/emails");
  assert.strictEqual((seen!.init.headers as Record<string, string>).Authorization, "Bearer re_key");
  assert.deepStrictEqual(JSON.parse(String(seen!.init.body)), {
    from: "Carmen <orders@example.com>", to: ["buyer@example.com"], reply_to: "hello@example.com", subject: "S", html: "<p>h</p>", text: "t",
    tags: [{ name: "template", value: "order_paid" }],
  });

  respond(429, { name: "daily_quota_exceeded", message: "You have exceeded your daily email sending quota." }, { "retry-after": "3600" });
  await assert.rejects(sendViaResend("re_key", msg), (e: unknown) => e instanceof SendError && !e.permanent && e.retryAfterSeconds === 3600 && /daily_quota_exceeded/.test(e.message));
  respond(422, { name: "validation_error", message: "Invalid `to` field." });
  await assert.rejects(sendViaResend("re_key", msg), (e: unknown) => e instanceof SendError && e.permanent && e.status === 422);
  respond(500, { name: "application_error" });
  await assert.rejects(sendViaResend("re_key", msg), (e: unknown) => e instanceof SendError && !e.permanent);
  globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  await assert.rejects(sendViaResend("re_key", msg), (e: unknown) => e instanceof SendError && e.status === 0 && !e.permanent);
});
