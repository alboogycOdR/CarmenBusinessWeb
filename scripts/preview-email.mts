/*
 * Render every transactional email with sample data, for design review and
 * client sign-off (PR 6). No database, no sending.
 *
 *   node scripts/preview-email.mts [output dir]     (default: ./email-preview)
 */
import fs from "node:fs";
import path from "node:path";
import { renderAdminAlert, renderManualAccessReady, renderOrderPaid, type Brand, type EmailContext, type RenderedEmail } from "../netlify/lib/email-templates.mts";

export const SAMPLE_BRAND: Brand = { name: "Carmen", siteUrl: "https://shop.example.com", replyTo: "hello@example.com", vatNumber: null };

export const SAMPLE: EmailContext = {
  email: { id: "00000000-0000-4000-8000-000000000001", template: "order_paid", to: "buyer@example.com", dedupe_key: "", attempts: 1 },
  order: {
    id: "00000000-0000-4000-8000-0000000000aa", reference: "CBW-7K2M9QX4TB", status: "paid", email: "buyer@example.com", currency: "ZAR",
    subtotal_minor: 299600, discount_minor: 29960, total_minor: 269640, tax_minor: 0, coupon_code: "SAVE10",
    paid_at: "2026-10-29T08:15:00Z", created_at: "2026-10-29T08:12:00Z", provider_txn_id: "1089250",
  },
  items: [
    { title: "The Signature Course: Your Complete Programme", type: "course", quantity: 1, line_total_minor: 199700, deliveries: [
      { fulfilment_id: "f1", kind: "external", status: "queued", label: "Course access", external_url: "https://courses.example.com/signature", instructions: "Sign in with the email you used at checkout.", access_mode: "instant", manual_eta_text: null },
      { fulfilment_id: "f2", kind: "file", status: "queued", label: "Signature workbook (PDF)", external_url: null, instructions: null, access_mode: "instant", manual_eta_text: null },
    ] },
    { title: "Live Masterclass Replay with Q&A", type: "course", quantity: 1, line_total_minor: 79700, deliveries: [
      { fulfilment_id: "f3", kind: "external", status: "action_required", label: "Masterclass replay access", external_url: "https://courses.example.com/masterclass", instructions: "We add you to the replay group by hand.", access_mode: "manual", manual_eta_text: "within 1 business day" },
    ] },
    { title: "The First Book", type: "book", quantity: 1, line_total_minor: 24900, deliveries: [
      { fulfilment_id: "f4", kind: "file", status: "queued", label: "The First Book (PDF)", external_url: null, instructions: null, access_mode: "instant", manual_eta_text: null },
      { fulfilment_id: "f5", kind: "file", status: "queued", label: "The First Book (EPUB)", external_url: null, instructions: null, access_mode: "instant", manual_eta_text: null },
    ] },
  ],
  failed_email: null,
};

export function previews(): { order_paid: RenderedEmail; manual_access_ready: RenderedEmail; admin_alert: RenderedEmail } {
  const links = new Map(["f2", "f4", "f5"].map((id) => [id, { url: `${SAMPLE_BRAND.siteUrl}/api/download?t=SAMPLE-${id}`, expiresAt: "2026-11-05T08:15:00Z", maxDownloads: 5 }]));
  const ready: EmailContext = { ...SAMPLE, email: { ...SAMPLE.email, template: "manual_access_ready", dedupe_key: "f3" } };
  const alert: EmailContext = { ...SAMPLE, email: { ...SAMPLE.email, template: "admin_alert", to: "owner@example.com" },
    failed_email: { id: "x", template: "order_paid", to: "buyer@example.com", attempts: 10, last_error: "resend 422 validation_error: Invalid `to` field" } };
  return {
    order_paid: renderOrderPaid(SAMPLE, links, SAMPLE_BRAND),
    manual_access_ready: renderManualAccessReady(ready, SAMPLE_BRAND),
    admin_alert: renderAdminAlert(alert, SAMPLE_BRAND),
  };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const out = path.resolve(process.argv[2] ?? "email-preview");
  fs.mkdirSync(out, { recursive: true });
  for (const [name, r] of Object.entries(previews())) {
    fs.writeFileSync(path.join(out, `${name}.html`), r.html);
    fs.writeFileSync(path.join(out, `${name}.txt`), `Subject: ${r.subject}\n\n${r.text}\n`);
  }
  console.log(`wrote ${Object.keys(previews()).length} emails to ${out}`);
}
