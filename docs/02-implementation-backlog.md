# Carmen Business Web: Implementation Backlog

| Item | Value |
|---|---|
| Version | 0.2: Payfast/ZAR (D1/D2) applied to PRs 3, 4, 7, 10, 13 |
| Date | 28 October 2026 |
| Depends on | [`01-architecture-review.md`](01-architecture-review.md) (ADRs, risks, decisions D1–D17) |
| Status | Approved. PR 0 and PR 1 merged. |

The work runs as 14 small PRs grouped into the spec's five phases. Each PR is independently reviewable and has its own tests. None of them deploy to production. Estimates are developer-days for one developer and include tests and docs.

---

## 1. Working agreement

- **Branching (needs approval, D11).** `main` is protected and is the base for all PRs. `staging` deploys to the Netlify staging context in payment **test mode**. Each PR has its own `feat/<nn>-<slug>` branch. Nothing merges without an approving human review, and nothing reaches production without a release approval.
- **Definition of Ready** for each PR: its blocking decisions are resolved (see the "Blocked by" column), and any test fixtures it needs (sample products and assets) exist.
- **Definition of Done** for each PR:
  - CI is green: unit, DB/RLS, function integration and e2e;
  - every new endpoint has validation, rate-limit and auth tests where relevant;
  - docs are updated;
  - the PR body is filled in using the template in §6, including an **Acceptance evidence** table;
  - for schema changes, a migration and rollback note.
- **Out of scope in every PR** (spec §9): student portal, LMS, video hosting, progress tracking, memberships, subscriptions, affiliates, community, certificates, and platform-specific course enrolment APIs.

---

## 2. PR plan overview

| PR | Phase (spec §8) | Title | Journeys / spec | Blocked by | Est. (days) |
|---|---|---|---|---|---|
| 0 | 1 | Repo foundation and CI | §6, §8 | D11 | 1 |
| 1 | 1 | Database schema, RLS, seed, generated types | §4, §5, §6 | D9 (staging project) | 3 |
| 2 | 1 | Catalogue from DB: build pipeline, SEO URLs, quantity = 1 | J1, J7 (read side) | PR 1 | 3 |
| 3 | 2 | Payfast checkout: ZAR migration, signed form, pending orders | J2 | ~~D1, D2, D14~~ ✓, D6, D8, D12, D17 | 3.5 |
| 4 | 2 | Payfast ITN (4 checks), idempotent confirmation, order status | J2, §4.2 | PR 3; **D16** for the sandbox run | 3 |
| 5 | 3 | Private storage, delivery tokens, download endpoint | J3 | D4, D5 | 2.5 |
| 6 | 3 | Email outbox, templates, external and mixed delivery | J3, J4, J5 | D3, D4, D7 | 3 |
| 7 | 3 | Admin-initiated refunds (Payfast Refunds API), chargebacks, revocation | §4.2 | PR 4–6, **PR 8**, D15 | 2.5 |
| 8 | 4 | Admin authentication, roles, MFA, audit log | J6, J7, §4.3 | D10 | 2.5 |
| 9 | 4 | Admin catalogue: products, categories, assets, coupons, publish | J7 | PR 8 | 4 |
| 10 | 4 | Admin orders: search, resend, revoke/renew, manual fulfilment, replay | J6 | PR 8 | 3 |
| 11 | 4 | Metrics, structured logging, monitoring and alerts | §4.3, §6 | PR 10 | 2 |
| 12 | 5 | Content, consent, SEO/CSP/accessibility polish | §6, §10 | D3, D7, D12, D13 + client content | 3 |
| 13 | 5 | Staging deployment, runbooks, backups, go-live checklist, UAT | §6, §11 | D9, D10 | 2 |
| | | **Total** | | | **38 dev-days** (+20% contingency ≈ 46) |

*v0.2 note: Payfast adds 1 day (PR 3 +0.5, PR 7 +0.5). The v0.1 total of "≈ 38" was mis-summed (its rows added to 37), so the corrected total stays at 38.*

**Critical path:** PR 0 ✓ → PR 1 ✓ → PR 3 (D1/D2 resolved: Payfast, ZAR) → PR 4 → PR 5/6 → PR 8 → PR 7 → PR 9/10 → PR 13. PR 7 now follows PR 8, because Payfast refunds are admin-initiated and need admin auth. PRs 2, 8 and 12 can run in parallel with the payment track once PR 1 has merged.

---

## 3. PR details

### PR 0: Repo foundation and CI
**Scope**
- `package.json`: add `devDependencies` (playwright, typescript, `@types/node`), a lockfile, and `engines.node` with `.nvmrc` set to 22. *(As built: the Supabase CLI moved to PR 1, where it is first used, so it isn't a dead dependency.)*
- `tsconfig.json` for `netlify/functions/**` and `scripts/**`.
- GitHub Actions workflow running these jobs: `unit`, `e2e` (Playwright), and later `db` (Supabase local) and `functions`.
- `.env.example` listing every variable, with no values.
- Secret scanning (gitleaks action) and `.github/pull_request_template.md` (§6).
- `docs/adr/` seeded from the architecture review.

**Tests:** the existing 21 unit tests and 13 e2e scenarios run in CI and pass unchanged.
**Acceptance:** CI runs on a PR, a red test blocks merge, and secret scanning flags a planted test key in a throwaway commit.
**Rollback:** revert. No runtime change.

### PR 1: Database schema, RLS, seed, generated types
**Scope**
- `supabase/migrations/*`: every table in review §3.5, the enums, unique constraints, `updated_at` triggers and the `public_catalog` view.
- Helper functions `is_admin()` and `is_aal2()`, an append-only `audit_log` (UPDATE and DELETE revoked) and default-deny RLS on every table.
- `supabase/seed.sql`: sample categories and products covering file, external-instant, external-manual and bundle; one coupon; one admin profile created only in seed.
- Generate `types/database.ts`. Add a `db` job to CI that starts Supabase locally. *(As built: no staff account is seeded, because tests create their own users and real staff are granted by script in PR 8, so no usable password is committed. See [`database.md`](database.md) §7.)*

**Tests:** pgTAP or SQL tests run as `anon`, `authenticated` (no admin profile), `admin` with aal1 and `admin` with aal2. They prove:
- `anon` reads only published rows from `public_catalog`;
- `anon` and plain `authenticated` users cannot read `product_assets`, `orders` or `payment_events`, or write any table;
- an admin at aal1 is denied writes and an admin at aal2 is allowed;
- `audit_log` cannot be updated or deleted.

**Acceptance:** spec §7 "Admin access", database layer. The schema is reviewed and the seed loads.
**Migration/rollback:** forward-only migrations, plus a documented down script for a fresh staging reset. No production database exists yet.

### PR 2: Catalogue from DB, build pipeline, SEO URLs, quantity = 1
**Scope**
- `scripts/build-catalog.mjs` reads `public_catalog` (anon key) and generates:
  - `assets/js/catalog.js`;
  - `/product/<slug>/index.html` pre-rendered pages with unique `<title>`, meta description, canonical URL, Open Graph tags and `Product` JSON-LD;
  - `sitemap.xml` and a `robots.txt` sitemap line.
- Netlify build command and redirects from `product.html?id=x` to `/product/x/` (301).
- `site-config.js` keeps brand and content but loses `products`. `lib.js` and `main.js` read `window.CATALOG`.
- Remove the per-product `checkoutUrl` buy links (G7). Hide the quantity control unless `allow_quantity` is set, and make `cartAdd` cap at 1 (G9, ADR-08).
- Product `images` support with `srcset` and the generated-cover fallback kept.

**As built (PR 2):**
- The build is `scripts/build.mts`, run with Node's native type stripping (Node ≥ 22.18), so there is no bundler. It publishes `dist/`.
- Templating is shared by the browser and the build (`assets/js/render.js`), so pre-rendered pages and the live view are the same markup.
- All links are root-absolute. This also fixes the 404 page, which loaded no CSS or JS when served below the root.
- **Removed the Stripe checkout prototype early.** It priced from `site-config.js` products, which no longer exist, and ADR-0009 supersedes it. The per-product `checkoutUrl` links went with it (G6, G7).
- The **"Verified buyer" badge now shows only for reviews marked `verified: true`**, so placeholder reviews no longer claim it (G8, brought forward from PR 12).
- The storefront now shows the `guide` and `template` types from the schema as their own categories, with portrait covers.

**Tests:**
- unit tests for the catalogue transform and cart quantity rules;
- a build test that fails if any generated file contains `product_assets` fields or storage paths (R4);
- updated e2e for J1, including the slug URLs.

**Acceptance:** J1 still passes on desktop and mobile; every product has a unique title and canonical URL and appears in the sitemap.
**Rollback:** revert. The previous static catalogue is restored by the revert.

### PR 3: Payfast checkout (ZAR, signed form, pending orders)
*D1/D2 resolved: Payfast and ZAR ([ADR-0009](adr/0009-payfast-gateway-and-zar.md)). Re-validate Payfast docs before coding (A4).*

**Scope**
- **Migration:** add `payfast` to `payment_provider`. Switch the catalogue to **ZAR**, with placeholder rand prices in the seed until the client supplies real ones. Add constraints so products, orders and amount-coupons can only be in ZAR. Regenerate types.
- `netlify/functions/_lib/payments/{provider.ts, payfast.ts}`: the `PaymentProvider` interface (ADR-0007) and the Payfast implementation of `buildCheckout`, which returns the signed form fields with MD5 over the documented field order, upper-case URL encoding, `+` for spaces and the passphrase. Covered by **known-answer tests** against signatures computed exactly as Payfast documents.
- `checkout` rewritten as a v2 function with `config.rateLimit`. It:
  - validates input (schema);
  - loads published products and the coupon from the DB;
  - enforces coupon window, max redemptions and per-email limit;
  - computes the total server-side and inserts the `pending` order and items with a provider reference and a hashed access key;
  - rejects totals under **R5.00** (D14);
  - returns the signed Payfast form fields (`m_payment_id = orders.reference`, amount in rands with 2 decimals), which the browser auto-submits to `/eng/process` (sandbox host when `PAYFAST_MODE=sandbox`);
  - returns `409 price_changed` on an `expectedTotal` mismatch.
- Storefront prices shown in rands (D17); the coupon editor guard against 100% coupons follows in PR 9.
- **Remove the per-request coupon creation** from the prototype (G6).
- Cart page: an email field, a required terms checkbox and a separate, **unticked** marketing opt-in (G12, spec §4.3).
- `success.html` replaced by a status page that polls `/api/order-status` and shows a neutral "confirming" message (G3). It never claims success here, because that arrives in PR 4.
- A scheduled cleanup marks stale `pending` orders `expired`.

**Tests:** no network; Payfast fixtures use fake credentials, never the published sandbox values.
- **Tampering** (spec §7): modified price, discount, product ID, currency, quantity or `expectedTotal` cannot lower the charged amount; the signed `amount` always equals the DB computation; editing any signed field invalidates the signature.
- Totals of R4.99 are rejected and R5.00 is accepted; a non-ZAR product is impossible (DB constraint).
- Unknown, draft or archived product → 400; expired or exhausted coupon → 400; rate limit → 429.
- A pending order is persisted **before** the provider call, and a provider failure leaves the order `failed`.
- e2e: cart to provider redirect (mocked); the status page shows neutral text.

**Acceptance:** J2 (payment initiation), spec §7 "Tampering" and "Failed or abandoned payment" (no paid order, no link, no success message).

### PR 4: Payfast ITN, idempotent confirmation, order status
**Scope**
- A `payfast-itn` v2 function (form-encoded POST) that runs **all four Payfast checks**, failing closed:
  1. MD5 signature with the passphrase, compared in constant time;
  2. the connecting IP resolves from `www`, `w1w`, `w2w` or `sandbox.payfast.co.za` (never `Referer`);
  3. `amount_gross` equals the order total **exactly**, and `merchant_id` and `m_payment_id` match;
  4. server confirmation from `/eng/query/validate` is `VALID`.

  It then inserts `payment_events` with `provider_event_id = pf_payment_id:payment_status` (deduplicated on `UNIQUE(provider, provider_event_id)`) and, for `COMPLETE`, calls `confirm_payment(order_id, event_id)`. It returns 200 once the event is durably stored, so Payfast stops retrying.
- `confirm_payment()` (SQL, one transaction): pending → paid, and idempotently creates fulfilment rows and the email outbox row.
- Failed events are stored with the error.
- `scripts/replay-event.ts` (and later the admin button) safely re-processes them.
- `order-status` returns `{status, items:[{title, delivery summary}]}` only with a valid `ref` + `k`; the page now says "Payment received" only on `paid` and clears the cart then.

**Tests:**
- **Webhook replay** (spec §7): the same ITN POSTed 3 times gives one paid order, one fulfilment set and one outbox row.
- Each check fails independently and leaves no paid order: a bad signature, a non-Payfast source IP, an amount R0.01 off, a foreign `merchant_id`, an unknown reference, and validate returning `INVALID` or timing out. Every failure is stored as a failed event for replay.
- A sandbox ITN against a live-mode order is rejected (and the reverse).
- Out-of-order or concurrent duplicate events (parallel requests) still give one fulfilment, enforced by the DB constraint.
- Replaying a `failed` event after fixing the cause succeeds exactly once.

**Acceptance:** spec §7 "Checkout success" (exactly one paid order and one delivery set) and "Webhook replay". Tested with the fixture suite and in the **Payfast sandbox on the staging deploy**, which needs a public `notify_url` (D16). The sandbox sends each ITN only once, so the replay tool is exercised there too.

### PR 5: Private storage, delivery tokens, download endpoint
**Scope**
- A private Supabase bucket `product-files` (no public policy).
- `issue_delivery_tokens()` creates 32-byte random tokens and stores only their SHA-256 hash, with expiry and a max-download count (D5).
- A `download` v2 function with rate limiting. It checks that the hash exists, the order is `paid`, and the token is not revoked, not expired and under its count. It then increments the count atomically, creates a **60 s** signed URL and responds 302 with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Denials return an HTML page that tells the buyer how to get help.

**Tests (spec §7 "Download security"):**
- unpaid, expired, revoked, over-limit, malformed and unknown tokens are each denied;
- a valid token redirects to a signed URL that works and has expired 60 s later;
- concurrent downloads at the limit do not exceed it;
- no generated HTML or JS contains a storage path.

**Acceptance:** J3 at the link-issuance level. Email delivery arrives in PR 6.

### PR 6: Email outbox, templates, external and mixed delivery
**Scope**
- Resend adapter.
- Templates (HTML + text) for: *order paid / receipt*, *delivery* (per item: download links, external link + instructions, or manual "access pending, expected within X"), *manual access ready*, *refund* and *support*.
- An outbox worker (scheduled function, plus a direct kick after confirmation) with exponential backoff, a maximum number of attempts and `email_events` logging.
- Admin alert on permanent failure.
- Receipt with VAT details per D3. Purchase emails carry no marketing content (§4.3).

**Tests:**
- **Mixed delivery** (spec §7): one book + one external course give both deliveries in one email.
- Bundle → the child items' assets; external-manual → the fulfilment is `action_required` and the wording is truthful (snapshot test).
- **Email outage** (spec §7): the provider returns 5xx → the order stays `paid`, the outbox is `queued` with `next_attempt_at`, and a later run sends once.
- No duplicate emails when the worker overlaps.

**Acceptance:** J3, J4, J5, spec §7 "Mixed delivery" and "Email outage".

### PR 7: Admin-initiated refunds, chargebacks, cancellations
*Payfast sends no refund or chargeback notifications (ADR-0009), so these are admin actions. Depends on PR 8 (admin auth).*

**Scope**
- An `admin-refund` function (owner/admin, aal2, audited). It calls the Payfast **Refunds API**: query first (`GET /refunds/query/{pf_payment_id}`), then create (`POST /refunds/{pf_payment_id}`, cents), with the API signature (alphabetised MD5 plus the passphrase), `merchant-id`, `version` and `timestamp` headers, and `?testing=true` in sandbox. Where Payfast requires a bank payout, it returns "complete in the Payfast dashboard, then record" (D15).
- A "record refund" action for refunds done in the dashboard, and a "mark disputed / dispute resolved" action for chargebacks.
- `record_refund()` (SQL, one transaction) updates the order status and `refunded_minor`, revokes delivery tokens for the affected items, and creates an `action_required` admin task for external access.
- Abandoned payments need no action: pending orders expire, and a late `COMPLETE` ITN is still honoured.
- Refund email.
- Financial rows are append-only.

**Tests:**
- **Refund** (spec §7): the refund is recorded, and an existing valid token is denied after the refund.
- A partial refund revokes only the refunded items.
- Double-clicking refund → one Payfast refund call and one record (idempotency key per refund request).
- Payfast refund API errors (401 signature, 429 rate limit, `NOT_AVAILABLE`) leave the order unchanged and are surfaced to the admin.
- A dispute marks the order `disputed` and revokes access as per policy (D7).

**Acceptance:** spec §4.2 refunds/chargebacks; spec §7 "Refund".

### PR 8: Admin authentication, roles, MFA, audit log
**Scope**
- `/admin/` single-page shell (vanilla JS, shares design tokens) and Supabase Auth email/password sign-in.
- **TOTP enrolment enforced**: no admin data is shown below aal2.
- No sign-up UI. `scripts/grant-admin.ts` (owner-run) creates `admin_profiles`.
- The `_lib/auth.ts` middleware verifies the JWT, the role and aal2 for every admin function. Admin actions write to the audit log.
- Strict CSP and `X-Frame-Options: DENY` on `/admin/*`; `noindex`.

**Tests (spec §7 "Admin access"):**
- anonymous users, users without an admin profile, and admins at aal1 are each denied on every admin function and table;
- a forged or expired JWT → 401;
- there is no route to self-assign a role;
- audit entries are created and are immutable.

**Acceptance:** spec §4.3 admin login and role checks on server and database.

### PR 9: Admin catalogue
**Scope**
- Admin CRUD for products (draft/published/archived; archive, never hard-delete if ordered), categories, bundles and coupons.
- **Assets:** file upload via signed upload URLs to the private bucket, plus external URL, instructions, instant/manual and manual ETA text.
- Input validation in the DB (constraints) and the UI.
- A "Publish changes" button calls the Netlify build hook and shows the deploy status.

**Tests:**
- RLS-backed write tests;
- uploaded files are not publicly reachable;
- an archived product is no longer purchasable (checkout 400) but still appears on past orders;
- after publish, the e2e build reflects an edited price, and checkout charges the DB price even before the rebuild (R10).

**Acceptance:** J7: an authorised admin can create, edit and archive products without a code deployment.

### PR 10: Admin orders
**Scope**
- Order search (reference, email, date, status) and order detail (items, payments, fulfilments, email log, events).
- Actions, all audited: **resend delivery**, **revoke / renew links**, **mark manual access granted**, **replay failed ITN**, **refund** / **record refund** / **mark disputed** (UI for the PR 7 functions; owner/admin only), record a manual note.
- Support view of `payment_events` with status `failed`.

**Tests:**
- Resend sends exactly one new email per click and is rate-limited.
- Renew issues new tokens and revokes the old ones (the old link is denied, the new one works).
- A support role cannot record refunds or edit products (role matrix).

**Acceptance:** J6, spec §7 "Email outage" (admin can resend).

### PR 11: Metrics, logging, monitoring
**Scope**
- SQL views and an admin dashboard showing completed orders, gross sales, refunded orders, top products, and tax and net shown separately (§4.3).
- Structured JSON logs with request IDs and no PII beyond the order reference.
- A scheduled `health` function that alerts the owner by email when it finds failed payment events, failed fulfilments or emails, storage errors, or an error-rate spike.

**Tests:** view correctness against seeded orders (including refunds), alert triggered by seeded failures, and no PII in log fixtures.
**Acceptance:** spec §6 production monitoring; §4.3 metrics.

### PR 12: Content, consent, SEO/CSP/accessibility polish
**Scope**
- Replace placeholder content with client-approved copy, products, images, legal pages (reviewed for jurisdiction, including POPIA) and real reviews, or hide the reviews page (D13). Remove the "Verified buyer" badge unless verified (G8).
- Newsletter consent wording and a record, kept separate from purchase comms.
- A CSP that refactors the inline `style=""` attributes (G15).
- An automated axe accessibility audit in e2e and a Lighthouse budget.
- A placeholder lint test that fails CI on "Replace with", `example.com` or the "Verified buyer" badge without a `verified` flag.

**Acceptance:** spec §7 "Content/QA" (real content, valid links via a link checker, mobile testing, accessibility audit passing at WCAG 2.1 AA for automated checks).

### PR 13: Staging, runbooks, go-live
**Scope**
- Netlify staging context and a separate Supabase staging project, using the **Payfast sandbox** (`PAYFAST_MODE=sandbox`, sandbox merchant credentials and passphrase, `notify_url` on the staging domain).
- `docs/runbooks/`:
  - deploy;
  - rotate keys;
  - backups and **restore drill**;
  - replay failed webhooks;
  - resend delivery;
  - refund handling (Payfast API vs dashboard plus record, D15) and **chargeback handling** (Payfast emails → mark disputed);
  - incident response.
- Go-live checklist (spec §11), including the Payfast live switch: live merchant ID, key and passphrase in production env only, `PAYFAST_MODE=live`, production `notify_url` reachable, and one real low-value purchase refunded end to end. A UAT script mapping every J1–J7 journey and spec §7 test to manual steps, and a sign-off record.

**Acceptance:** spec §11 Definition of Done. **Production cut-over happens only after the named owner signs off (outside this PR).**

---

## 4. Acceptance traceability

### 4.1 Spec §7 acceptance tests

| Spec §7 scenario | Automated in | Sandbox/UAT in |
|---|---|---|
| Checkout success: one paid order, one delivery set | PR 4 (`webhook.confirm.once`), PR 6 | PR 13 UAT on staging, provider test mode |
| Failed or abandoned payment | PR 3 (`checkout.provider_failure`, status page neutral), PR 4 (lookup mismatch) | PR 13 |
| Webhook replay ×3 → one fulfilment | PR 4 (`webhook.replay.x3`, `webhook.concurrent`) | PR 13 (provider "resend event") |
| Tampering | PR 3 (`checkout.tamper.*`) | PR 13 |
| Mixed delivery | PR 6 (`delivery.mixed`) | PR 13 |
| Download security | PR 5 (`download.*`) | PR 13 |
| Email outage | PR 6 (`outbox.retry`), PR 10 (`admin.resend`) | PR 13 |
| Admin access | PR 1 (RLS suite), PR 8 (function authz) | PR 13 |
| Refund | PR 7 (`refund.*`) | PR 13 |
| Content/QA | PR 12 (axe, link check, placeholder lint, mobile e2e) | PR 13 + client sign-off |

### 4.2 Journeys

| Journey | Delivered by |
|---|---|
| J1 Browse/search/filter | Existing; preserved and re-verified in PR 2 |
| J2 Guest checkout | PR 3, PR 4 |
| J3 File purchase | PR 5, PR 6 |
| J4 External course | PR 6 |
| J5 Mixed basket | PR 6 |
| J6 Support/recovery | PR 10 (with PR 5 renew/revoke) |
| J7 Product administration | PR 9 (with PR 2 publish pipeline) |

---

## 5. Test strategy

| Layer | Tool | Runs in |
|---|---|---|
| Pure logic (storefront, pricing, tokens) | `node:test` | CI `unit` |
| Database, RLS, SQL functions | Supabase local (Docker) + SQL/pgTAP tests, executed as anon, authenticated, admin aal1 and admin aal2 roles | CI `db` |
| Functions | `node:test` against local Supabase; provider and email HTTP mocked with recorded, signed fixtures; Netlify v2 handlers invoked directly | CI `functions` |
| End-to-end | Playwright against `netlify dev` + local Supabase (existing suite extended) | CI `e2e` |
| Provider sandbox | Real test-mode transactions and webhooks on staging | PR 4+ manually, PR 13 UAT |
| Security | gitleaks, a build-output secret/asset grep, authz matrix tests, rate-limit tests, `npm audit` | CI |

---

## 6. Pull request template (added in PR 0)

```markdown
## Scope
<what changed and why; spec refs>
## Out of scope (spec §9)
## Decisions / assumptions
<D-ids resolved or assumed; new assumptions>
## Acceptance evidence
| Criterion (spec ref) | How verified | Test name / screenshot |
|---|---|---|
## Screenshots (UI changes)
## Migration & rollback
## Security checklist
- [ ] Inputs validated  - [ ] AuthZ enforced in function **and** RLS  - [ ] No secrets/PII in code, logs or build output
- [ ] Rate limits on public endpoints  - [ ] Idempotency on side-effects
## Reviewer checklist
- [ ] Tests meaningful and green  - [ ] Docs/runbooks updated  - [ ] No production change
```

---

## 7. Immediate next steps (on approval)

1. Approve or amend the ADRs in the architecture review (§5), especially **ADR-01 (keep static front end)** and **ADR-06 (DB catalogue + build-hook publish)**.
2. Resolve **D11** (branch model and permission to create `main`, `staging` and `feat/*`) to unblock PR 0.
3. Resolve **D9** (Supabase staging project; production plan approval later) to unblock PR 1.
4. Start the client intake for **D1/D2** (gateway and currency) now, because they are on the critical path for PR 3.
