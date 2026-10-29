/* Payfast signature and form tests. The vectors were produced by Payfast's own
 * PHP generateSignature() (copied verbatim from the docs), so these tests check
 * our implementation against the reference, not against itself. */
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  amountString, buildCheckout, CHECKOUT_FIELD_ORDER, ipInCidrs, itnParamString, normaliseIp, PAYFAST_ITN_CIDRS, parseAmountMinor, parseItnBody,
  phpStripslashes, phpTrim, phpUrlencode, processUrl, signature, validateUrl, verifyItnSignature,
} from "../netlify/lib/payfast.mts";

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

/* ---------- ITN (PR 4) ---------- */

const ITN = JSON.parse(fs.readFileSync(path.join(here, "fixtures/payfast_itn_vectors.json"), "utf8")) as {
  vectors: Array<{ name: string; passphrase: string; body: string; paramString: string; signature: string }>;
};

test("ITN signatures match Payfast's PHP reference code exactly", () => {
  assert.ok(ITN.vectors.length >= 4);
  for (const v of ITN.vectors) {
    const pairs = parseItnBody(v.body);
    assert.ok(pairs, v.name);
    assert.strictEqual(itnParamString(pairs!, true), v.paramString, `${v.name}: parameter string`);
    const check = verifyItnSignature(pairs!, v.passphrase);
    assert.strictEqual(check.ok, true, `${v.name}: verifies`);
    assert.strictEqual(check.paramString, v.paramString, `${v.name}: validate is posted the signed string`);
    assert.strictEqual(verifyItnSignature(pairs!, v.passphrase + "x").ok, false, `${v.name}: wrong passphrase fails`);
  }
});

test("ITN signature: any change to a signed field, or a missing/odd signature, fails", () => {
  const v = ITN.vectors[0]!;
  const pairs = parseItnBody(v.body)!;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i]![0] === "signature") continue;
    const tampered = pairs.map((p, j) => (j === i ? [p[0], p[1] + "1"] as [string, string] : p));
    assert.strictEqual(verifyItnSignature(tampered, v.passphrase).ok, false, `tampered ${pairs[i]![0]}`);
  }
  const reordered = [pairs[1]!, pairs[0]!, ...pairs.slice(2)];
  assert.strictEqual(verifyItnSignature(reordered, v.passphrase).ok, false, "field order is signed");
  assert.strictEqual(verifyItnSignature(pairs.filter(([k]) => k !== "signature"), v.passphrase).ok, false, "no signature");
  assert.strictEqual(verifyItnSignature(pairs.map(([k, x]) => [k, k === "signature" ? x.toUpperCase() : x] as [string, string]), v.passphrase).ok, false, "upper-case hex is not Payfast's format");
  const extra = ITN.vectors.find((x) => x.name.includes("after the signature"))!;
  assert.ok(extra.body.includes("extra_field="), "vector carries an unsigned trailing field");
});

test("ITN body parsing refuses what PHP would merge or rename", () => {
  assert.deepStrictEqual(parseItnBody("a=1&b=&c=x+y"), [["a", "1"], ["b", ""], ["c", "x y"]]);
  assert.strictEqual(parseItnBody("a=1&a=2"), null, "duplicate key");
  assert.strictEqual(parseItnBody("a.b=1"), null, "PHP turns dots into underscores");
  assert.strictEqual(parseItnBody("a[]=1"), null, "PHP arrays");
});

test("stripslashes behaves like PHP's", () => {
  assert.strictEqual(phpStripslashes("C:\\\\dir\\\\file"), "C:\\dir\\file");
  assert.strictEqual(phpStripslashes("O\\'Brien \\\"x\\\""), "O'Brien \"x\"");
  assert.strictEqual(phpStripslashes("a\\0b"), "a\0b");
  assert.strictEqual(phpStripslashes("trailing\\"), "trailing");
});

test("source IP: Payfast's published ranges only", () => {
  const inside = ["197.97.145.144", "197.97.145.159", "41.74.179.192", "41.74.179.223", "102.216.36.0", "102.216.36.15", "102.216.36.128", "102.216.36.143", "144.126.193.139", "::ffff:197.97.145.150"];
  const outside = ["197.97.145.143", "197.97.145.160", "41.74.179.224", "102.216.36.16", "102.216.36.127", "144.126.193.138", "10.0.0.1", "127.0.0.1", "", "not-an-ip", "2001:db8::1", "256.1.1.1"];
  for (const ip of inside) assert.strictEqual(ipInCidrs(ip, PAYFAST_ITN_CIDRS), true, ip);
  for (const ip of outside) assert.strictEqual(ipInCidrs(ip, PAYFAST_ITN_CIDRS), false, ip);
  assert.strictEqual(normaliseIp(" ::FFFF:41.74.179.200 "), "41.74.179.200");
  assert.strictEqual(ipInCidrs("1.2.3.4", ["0.0.0.0/0"]), true, "a /0 matches everything (mask edge case)");
});

test("amount_gross is parsed to exact cents", () => {
  assert.strictEqual(parseAmountMinor("448.00"), 44800);
  assert.strictEqual(parseAmountMinor("5.5"), 550);
  assert.strictEqual(parseAmountMinor("1997"), 199700);
  assert.strictEqual(parseAmountMinor("0.07"), 7);
  for (const bad of [undefined, "", "-5.00", "5.001", "1e3", " 5.00", "5,00", "R5.00", "0x10"]) assert.strictEqual(parseAmountMinor(bad), null, String(bad));
});

test("validate endpoint per mode", () => {
  assert.strictEqual(validateUrl("sandbox"), "https://sandbox.payfast.co.za/eng/query/validate");
  assert.strictEqual(validateUrl("live"), "https://www.payfast.co.za/eng/query/validate");
});
