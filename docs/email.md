# Transactional email: setup and operations

PR 6. Decisions: **D9 / D18** use the Resend **Free plan** for launch and revisit it later; **D19** sends from `orders@<client's domain>`. See the [architecture review](01-architecture-review.md) §6 and [ADR-0004](adr/0004-outbox-pattern-for-transactional-email.md).

## 1. What is sent

| Email | When | Content |
|---|---|---|
| **Order receipt and access** (`order_paid`) | As soon as the ITN confirms payment. The ITN function sends it straight away when it has time; otherwise the worker sends it within 2 minutes | **One email for the whole order** (spec §7 "Mixed delivery"): a **Download** button per file (7 days, 5 downloads, D5), the course link and instructions for instant external access, and truthful wording for manual access ("we set this up for you by hand, within 1 business day"). Then the receipt: items, discount, total, date, Payfast transaction, and the VAT number if `VAT_NUMBER` is set (D3) |
| **Your access is ready** (`manual_access_ready`) | When staff confirm hand-granted access (§4) | The course link and instructions |
| **Admin alert** (`admin_alert`) | When a buyer email fails permanently | Which order, which email, the last error, the next step. Goes to `ALERT_EMAIL_TO` |

Purchase emails contain **no marketing** (spec §4.3). To review the design without sending anything, run:

```bash
node scripts/preview-email.mts ./email-preview
```

It writes the HTML and text of every email with sample data, for client sign-off. The text versions are pinned by snapshot tests (`tests/fixtures/email/*.txt`), so any change to the wording is deliberate and visible in review.

## 2. How delivery stays reliable (the outbox)

1. **Queued with the payment.** `confirm_payment()` queues the email in the **same transaction** as the payment, so a paid order always has its email queued.
2. **Claimed by a worker.** The worker, `send-emails` (scheduled every 2 minutes), claims due emails with `FOR UPDATE SKIP LOCKED` and a 5-minute lease, so **overlapping runs never send the same email**.
3. **On failure:**
   - a temporary failure (5xx, network, 429 rate limit or daily quota, bad key or unverified domain) **retries with exponential backoff** (1, 2, 4 … 256 minutes, about 8.5 hours in total) and honours `Retry-After`;
   - a permanent rejection (400/422, e.g. an invalid address), or 10 attempts, marks it `failed` and sends **one admin alert**.
4. **The order is never affected.** It stays `paid` throughout (spec §7 "Email outage").
5. **Download links are created at send time.** A retry creates fresh links and **never revokes earlier ones**. If a send that looked failed was actually delivered, the buyer's first email still works; the worst case is a duplicate email, never a dead link.

## 3. Setup (owner, before go-live)

1. **Create a Resend account** on the Free plan (D9), owned by the client (D10).
2. **Add the domain.** In Resend, add the client's domain (or a subdomain such as `mail.<domain>`), then add the DNS records Resend shows at the domain's DNS host. Resend generates the exact values per domain:
   - **DKIM:** a TXT record at `resend._domainkey`;
   - **SPF and bounces:** an MX record and a TXT (SPF) record on the sending subdomain Resend names (e.g. `send`).

   Wait for Resend to show **Verified**.
3. **Add DMARC.** Recommended: a TXT record at `_dmarc` with the value `v=DMARC1; p=none; rua=mailto:<client's address>;`. Tighten it later, once reports show SPF and DKIM passing.
4. **Create an API key** with **Sending access** only, restricted to that domain.
5. **Set the Netlify environment variables.** Use separate values for staging and production, and never commit them:

| Variable | Example | Required |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | yes |
| `EMAIL_FROM` | `Carmen <orders@clientdomain.co.za>` (D19) | yes |
| `EMAIL_REPLY_TO` | `hello@clientdomain.co.za`, where buyer replies go | recommended |
| `ALERT_EMAIL_TO` | the owner's address, for failed-email alerts | recommended |
| `VAT_NUMBER` | only if VAT-registered (D3) | optional |
| `STORE_NAME`, `SITE_URL` | already set for checkout | yes |

Without `RESEND_API_KEY` or `EMAIL_FROM`, nothing is sent and emails wait in the queue. They go out once the variables are set.

## 4. Manual access (J5)

When a buyer purchases something with manual access (for example the masterclass replay group):

1. Their order email says, truthfully, that access is being set up and when to expect it. The delivery shows as `action_required`.
2. Staff add the buyer in the course platform, then confirm it:

```bash
node scripts/grant-manual-access.mts CBW-XXXXXXXXXX
```

```bash
node scripts/grant-manual-access.mts CBW-XXXXXXXXXX --grant <id>
```

   The first command lists what is waiting; the second marks one item as done.
3. The buyer gets "Your access is ready". The admin screens (PR 10) will replace these commands.

## 5. Limits and when to upgrade (D18)

The Free plan allows 3,000 emails a month and 100 a day. Each order uses one email, plus one per manual-access item and one per alert.

If the daily limit is reached, Resend answers `429 daily_quota_exceeded`. Emails then **wait and go out after the quota resets**: they are late, not lost. Upgrade to Pro when any of these happen:
- a launch or promotion is expected to bring about **60 orders in one day**;
- monthly volume passes about **2,000 emails**;
- the Resend dashboard or the function logs show `daily_quota_exceeded`.

## 6. Troubleshooting

| Symptom | Where to look | Fix |
|---|---|---|
| A buyer says no email arrived | `email_events` for the order: status, attempts, `last_error`; then the Resend dashboard → Emails | Queued: it is retrying (see `last_error`). Sent: check the buyer's spam folder and the address. Failed: correct the address. Meanwhile, `scripts/issue-download-links.mts <ref>` gives links that support can email by hand |
| Every send fails with 401/403 | Function logs (`email_retry`) | Wrong `RESEND_API_KEY`, or the domain isn't verified. Fix it: the queued emails go out on the next run |
| An admin alert arrived | The alert text | Usually an invalid buyer address. Contact the buyer |
