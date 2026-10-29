/* Payfast signature and form tests. The vectors were produced by Payfast's own
 * PHP generateSignature() (copied verbatim from the docs), so these tests check
 * our implementation against the reference, not against itself. */
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { amountString, buildCheckout, CHECKOUT_FIELD_ORDER, phpTrim, phpUrlencode, processUrl, signature } from "../netlify/lib/payfast.mts";

const here = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(fs.readFileSync(path.join(here, "fixtures/payfast_signature_vectors.json"), "utf8")) as {
  source: string;
  cases: Array<{ name: string; passphrase: string | null; fields: Record<string, string>; signature: string }>;
};
const CREDS = { mode: "sandbox" as const, merchantId: "10000001", merchantKey: "fakekey00000a", passphrase: "test-passphrase-1" };

test("signature matches Payfast's PHP reference on every vector", () => {
  assert.ok(VECTORS.cases.length >= 3);
  for (const c of VECTORS.cases) {
    assert.strictEqual(signature(Object.entries(c.fields), c.passphrase), c.signature, c.name);
  }
});

test("phpUrlencode follows PHP urlencode, not encodeURIComponent", () => {
  assert.strictEqual(phpUrlencode("a b"), "a+b");
  assert.strictEqual(phpUrlencode("~*'()!"), "%7E%2A%27%28%29%21");
  assert.strictEqual(phpUrlencode("https://x.example/a?b=c&d"), "https%3A%2F%2Fx.example%2Fa%3Fb%3Dc%26d");
  assert.strictEqual(phpUrlencode("é"), "%C3%A9");
  assert.strictEqual(phpUrlencode("-_.AZaz09"), "-_.AZaz09");
});

test("phpTrim only strips PHP's whitespace set", () => {
  assert.strictEqual(phpTrim(" \t\n\r\0\x0Bx\x0B\0\r\n\t "), "x");
  assert.strictEqual(phpTrim(" x "), " x ", "non-breaking spaces are kept, as in PHP");
});

test("amountString formats cents without floating point", () => {
  assert.strictEqual(amountString(500), "5.00");
  assert.strictEqual(amountString(199700), "1997.00");
  assert.strictEqual(amountString(1), "0.01");
  assert.strictEqual(amountString(123456789), "1234567.89");
  assert.throws(() => amountString(1.5));
  assert.throws(() => amountString(-1));
});

test("buildCheckout produces ordered, signed sandbox fields", () => {
  const form = buildCheckout({ reference: "CBW-7K2M9QX4TB", totalMinor: 199700, email: "buyer@example.com", titles: ["The Signature Course: Your Complete Programme"] },
    CREDS, "https://shop.example.com", "Carmen");
  assert.strictEqual(form.action, "https://sandbox.payfast.co.za/eng/process");
  const names = form.fields.map(([k]) => k);
  assert.strictEqual(names.at(-1), "signature");
  const order = names.slice(0, -1).map((n) => CHECKOUT_FIELD_ORDER.indexOf(n as (typeof CHECKOUT_FIELD_ORDER)[number]));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1]!)), "fields follow Payfast's documented order");
  const f = Object.fromEntries(form.fields);
  assert.strictEqual(f.amount, "1997.00");
  assert.strictEqual(f.m_payment_id, "CBW-7K2M9QX4TB");
  assert.strictEqual(f.notify_url, "https://shop.example.com/api/payfast/itn");
  assert.strictEqual(f.return_url, "https://shop.example.com/success.html?ref=CBW-7K2M9QX4TB");
  // Equals the reference vector built from the same inputs.
  assert.strictEqual(f.signature, VECTORS.cases.find((c) => c.name === "basic order")!.signature);
  assert.ok(!JSON.stringify(form).includes(CREDS.passphrase), "the passphrase is never sent to the browser");
});

test("tampering with any signed field invalidates the signature", () => {
  const form = buildCheckout({ reference: "CBW-0000000000", totalMinor: 49700, email: "b@example.com", titles: ["Starter"] }, CREDS, "https://s.example", "Carmen");
  const fields = form.fields.slice(0, -1);
  const sig = form.fields.at(-1)![1];
  for (let i = 0; i < fields.length; i++) {
    const tampered = fields.map(([k, v], j) => [k, j === i ? v + "1" : v] as [string, string]);
    assert.notStrictEqual(signature(tampered, CREDS.passphrase), sig, `editing ${fields[i]![0]} must break the signature`);
  }
  const lowered = fields.map(([k, v]) => [k, k === "amount" ? "4.97" : v] as [string, string]);
  assert.notStrictEqual(signature(lowered, CREDS.passphrase), sig, "a lowered amount is detected");
  assert.notStrictEqual(signature(fields, "wrong-passphrase"), sig, "the signature depends on the passphrase");
});

test("live mode posts to the live host; long text is clipped by code point", () => {
  assert.strictEqual(processUrl("live"), "https://www.payfast.co.za/eng/process");
  const titles = Array.from({ length: 40 }, (_, i) => `Café course ${i} ✓`);
  const form = buildCheckout({ reference: "CBW-1111111111", totalMinor: 500, email: "b@example.com", titles }, { ...CREDS, mode: "live" }, "https://s.example", "Carmen");
  const desc = Object.fromEntries(form.fields).item_description!;
  assert.ok(Array.from(desc).length <= 255 && desc.endsWith("…"));
});
