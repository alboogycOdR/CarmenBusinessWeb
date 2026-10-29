/*
 * Transactional email templates (PR 6): HTML + plain text, pure functions.
 * Every value from the database is escaped; links are either our own site's
 * download links or https course links (enforced by a CHECK constraint).
 * Purchase emails carry no marketing content (spec §4.3).
 */

export interface DeliveryCtx {
  fulfilment_id: string;
  kind: "file" | "external";
  status: string;
  label: string;
  external_url: string | null;
  instructions: string | null;
  access_mode: "instant" | "manual";
  manual_eta_text: string | null;
}

export interface ItemCtx {
  title: string;
  type: string;
  quantity: number;
  line_total_minor: number;
  deliveries: DeliveryCtx[];
}

export interface OrderCtx {
  id: string;
  reference: string;
  status: string;
  email: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  tax_minor: number;
  coupon_code: string | null;
  paid_at: string | null;
  created_at: string;
  provider_txn_id: string | null;
}

export interface EmailContext {
  email: { id: string; template: string; to: string; dedupe_key: string; attempts: number };
  order: OrderCtx | null;
  items: ItemCtx[];
  failed_email: { id: string; template: string; to: string; attempts: number; last_error: string | null } | null;
}

/* A download link issued for this email: fulfilment → URL. */
export interface DownloadLink { url: string; expiresAt: string; maxDownloads: number }

export interface Brand {
  name: string;
  siteUrl: string;
  replyTo: string | null;
  vatNumber: string | null;
}

export interface RenderedEmail { subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NBSP = " ";

/* R1 997.00 (D17): no-break-space thousands, two decimals, from integer cents. */
export function zar(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const rands = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sign}R${rands}.${String(abs % 100).padStart(2, "0")}`;
}

export function saDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
}

/* ---------- layout ---------- */
const C = { ink: "#1f1f1f", muted: "#666666", line: "#e4e4e4", brand: "#e50069", tile: "#f6f6f6" };
const SERIF = "Lora, Georgia, 'Times New Roman', serif";
const SANS = "Roboto, Arial, Helvetica, sans-serif";

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr><td style="background:${C.brand};border-radius:4px">
<a href="${esc(href)}" style="display:inline-block;padding:12px 28px;font:15px ${SANS};color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
}

function shell(brand: Brand, preheader: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${esc(brand.name)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font:16px/1.6 ${SANS};color:${C.ink}">
<tr><td style="padding:0 0 18px;border-bottom:2px solid ${C.ink};font:italic 28px ${SERIF}">${esc(brand.name)}</td></tr>
<tr><td style="padding:24px 0">${body}</td></tr>
<tr><td style="padding:18px 0 0;border-top:1px solid ${C.line};font-size:13px;color:${C.muted}">
${esc(brand.name)} · <a href="${esc(brand.siteUrl)}" style="color:${C.muted}">${esc(brand.siteUrl.replace(/^https?:\/\//, ""))}</a><br>
You're receiving this email because of a purchase from ${esc(brand.name)}. It contains no marketing.</td></tr>
</table></td></tr></table></body></html>`;
}

const h1 = (s: string) => `<h1 style="margin:0 0 12px;font:500 28px/1.25 ${SERIF};color:${C.ink}">${esc(s)}</h1>`;
const p = (html: string, muted = false) => `<p style="margin:0 0 12px;${muted ? `color:${C.muted};font-size:14px` : ""}">${html}</p>`;

function helpLine(brand: Brand): { html: string; text: string } {
  const contact = `${brand.siteUrl}/contact.html`;
  const reply = brand.replyTo ? "Reply to this email or " : "";
  return {
    html: p(`Questions, or trouble accessing anything? ${reply}${brand.replyTo ? "contact" : "Contact"} us at <a href="${esc(contact)}" style="color:${C.brand}">${esc(contact)}</a>.`),
    text: `Questions, or trouble accessing anything? ${reply}${brand.replyTo ? "contact" : "Contact"} us at ${contact}.`,
  };
}

/* ---------- order_paid: receipt + every delivery in one email ---------- */
export function renderOrderPaid(ctx: EmailContext, links: Map<string, DownloadLink>, brand: Brand): RenderedEmail {
  const o = ctx.order;
  if (!o) throw new Error("order_paid email without an order");
  const html: string[] = [];
  const text: string[] = [];
  let anyDownload: DownloadLink | null = null;

  html.push(h1("Thank you for your order"));
  html.push(p(`Your payment for order <strong>${esc(o.reference)}</strong> was received. Here's how to access everything you bought.`));
  text.push(`Thank you for your order`, ``, `Your payment for order ${o.reference} was received. Here's how to access everything you bought.`, ``);

  for (const item of ctx.items) {
    html.push(`<div style="margin:18px 0;padding:16px 18px;background:${C.tile};border-radius:4px">`);
    html.push(`<h2 style="margin:0 0 6px;font:500 20px/1.3 ${SERIF}">${esc(item.title)}</h2>`);
    text.push(item.title.toUpperCase());
    if (item.deliveries.length === 0) {
      html.push(p("We'll be in touch about this item shortly."));
      text.push("We'll be in touch about this item shortly.");
    }
    for (const d of item.deliveries) {
      if (d.kind === "file") {
        const link = links.get(d.fulfilment_id);
        if (link) {
          anyDownload ??= link;
          html.push(button(link.url, `Download ${d.label}`));
          text.push(`- Download ${d.label}: ${link.url}`);
        } else {
          html.push(p(`${esc(d.label)}: please contact us and we'll send you this file.`));
          text.push(`- ${d.label}: please contact us and we'll send you this file.`);
        }
      } else if (d.access_mode === "manual") {
        // Truthful timing (spec §4.2): access is set up by hand.
        html.push(p(`<strong>${esc(d.label)}</strong>: we set this up for you by hand, ${esc(d.manual_eta_text ?? "as soon as we can")}. We'll email you as soon as it's ready; there's nothing you need to do.`));
        text.push(`- ${d.label}: we set this up for you by hand, ${d.manual_eta_text ?? "as soon as we can"}. We'll email you as soon as it's ready; there's nothing you need to do.`);
        if (d.instructions) { html.push(p(esc(d.instructions), true)); text.push(`  ${d.instructions}`); }
      } else if (d.external_url) {
        html.push(button(d.external_url, d.label));
        text.push(`- ${d.label}: ${d.external_url}`);
        if (d.instructions) { html.push(p(esc(d.instructions), true)); text.push(`  ${d.instructions}`); }
      }
    }
    html.push(`</div>`);
    text.push(``);
  }

  if (anyDownload) {
    const rule = `Download links work until ${saDate(anyDownload.expiresAt)}, for up to ${anyDownload.maxDownloads} downloads each. Save the files somewhere safe. If a link stops working, contact us and we'll send a new one.`;
    html.push(p(esc(rule), true));
    text.push(rule, ``);
  }

  // Receipt
  const rows = ctx.items.map((i) => [i.quantity > 1 ? `${i.title} × ${i.quantity}` : i.title, zar(i.line_total_minor)] as const);
  const totals: Array<readonly [string, string, boolean]> = [["Subtotal", zar(o.subtotal_minor), false]];
  if (o.discount_minor > 0) totals.push([`Discount${o.coupon_code ? ` (${o.coupon_code})` : ""}`, `-${zar(o.discount_minor)}`, false]);
  totals.push(["Total paid", zar(o.total_minor), true]);
  const td = (s: string, right = false, bold = false) =>
    `<td style="padding:6px 0;border-bottom:1px solid ${C.line};${right ? "text-align:right;white-space:nowrap;" : ""}${bold ? "font-weight:700;" : ""}">${esc(s)}</td>`;
  html.push(`<h2 style="margin:28px 0 8px;font:500 20px/1.3 ${SERIF}">Receipt</h2>`);
  html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">
${rows.map(([a, b]) => `<tr>${td(a)}${td(b, true)}</tr>`).join("")}
${totals.map(([a, b, bold]) => `<tr>${td(a, false, bold)}${td(b, true, bold)}</tr>`).join("")}</table>`);
  const meta = [
    `Order reference: ${o.reference}`,
    `Paid on ${saDate(o.paid_at)} via Payfast${o.provider_txn_id ? ` (transaction ${o.provider_txn_id})` : ""}`,
    ...(brand.vatNumber ? [`VAT registration number: ${brand.vatNumber}. Prices include VAT.`] : []),
  ];
  html.push(p(meta.map(esc).join("<br>"), true));
  text.push(`RECEIPT`, ...rows.map(([a, b]) => `${a}: ${b}`), ...totals.map(([a, b]) => `${a}: ${b}`), ``, ...meta, ``);

  const help = helpLine(brand);
  html.push(help.html);
  text.push(help.text, ``, `${brand.name} · ${brand.siteUrl}`, `You're receiving this email because of a purchase from ${brand.name}. It contains no marketing.`);

  return {
    subject: `Your ${brand.name} order ${o.reference}: receipt and access`,
    html: shell(brand, `Payment received for ${o.reference}. Your access details are inside.`, html.join("\n")),
    text: text.join("\n"),
  };
}

/* ---------- manual_access_ready (J5) ---------- */
export function renderManualAccessReady(ctx: EmailContext, brand: Brand): RenderedEmail {
  const o = ctx.order;
  const d = ctx.items.flatMap((i) => i.deliveries.map((x) => ({ ...x, title: i.title }))).find((x) => x.fulfilment_id === ctx.email.dedupe_key);
  if (!o || !d) throw new Error("manual_access_ready email without its order or delivery");
  const html = [h1("Your access is ready"), p(`Good news: we've set up <strong>${esc(d.label)}</strong> for ${esc(d.title)} (order ${esc(o.reference)}). You can start now.`)];
  const text = [`Your access is ready`, ``, `Good news: we've set up ${d.label} for ${d.title} (order ${o.reference}). You can start now.`, ``];
  if (d.external_url) { html.push(button(d.external_url, d.label)); text.push(`${d.label}: ${d.external_url}`); }
  if (d.instructions) { html.push(p(esc(d.instructions), true)); text.push(d.instructions); }
  const help = helpLine(brand);
  html.push(help.html);
  text.push(``, help.text, ``, `${brand.name} · ${brand.siteUrl}`);
  return {
    subject: `Your access to ${d.title} is ready`,
    html: shell(brand, `Your access to ${d.title} is ready.`, html.join("\n")),
    text: text.join("\n"),
  };
}

/* ---------- admin_alert: a buyer email failed permanently ---------- */
export function renderAdminAlert(ctx: EmailContext, brand: Brand): RenderedEmail {
  const f = ctx.failed_email;
  const ref = ctx.order?.reference ?? "(no order)";
  const lines = [
    `An email to a buyer could not be delivered and will not be retried.`,
    `Order: ${ref}`,
    `Email: ${f?.template ?? "?"} to ${f?.to ?? "?"} after ${f?.attempts ?? "?"} attempts`,
    `Last error: ${f?.last_error ?? "unknown"}`,
    `Next step: check the buyer's address and the Resend dashboard (resend.com/emails), then contact the buyer with their access details.`,
  ];
  return {
    subject: `[${brand.name}] Email to a buyer failed for order ${ref}`,
    html: shell(brand, `An email for order ${ref} failed.`, h1("A buyer email failed") + lines.map((l) => p(esc(l))).join("\n")),
    text: lines.join("\n"),
  };
}
