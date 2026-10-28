# Carmen Business Web: Implementation Backlog

| Item | Value |
|---|---|
| Version | 0.1 (for review) |
| Date | 28 October 2026 |
| Depends on | [`01-architecture-review.md`](01-architecture-review.md) (ADRs, risks, decisions D1–D13) |
| Status | **Plan only. Awaiting approval before PR 0.** |

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
| 3 | 2 | Payment adapter and server-side checkout (pending orders) | J2 | **D1, D2**, D6, D8, D12 | 3 |
| 4 | 2 | Verified webhooks, idempotent confirmation, order status | J2, §4.2 | PR 3 | 3 |
| 5 | 3 | Private storage, delivery tokens, download endpoint | J3 | D4, D5 | 2.5 |
| 6 | 3 | Email outbox, templates, external and mixed delivery | J3, J4, J5 | D3, D4, D7 | 3 |
| 7 | 3 | Refunds, chargebacks, cancellations, revocation | §4.2 | PR 4–6 | 2 |
| 8 | 4 | Admin authentication, roles, MFA, audit log | J6, J7, §4.3 | D10 | 2.5 |
| 9 | 4 | Admin catalogue: products, categories, assets, coupons, publish | J7 | PR 8 | 4 |
| 10 | 4 | Admin orders: search, resend, revoke/renew, manual fulfilment, replay | J6 | PR 8 | 3 |
| 11 | 4 | Metrics, structured logging, monitoring and alerts | §4.3, §6 | PR 10 | 2 |
| 12 | 5 | Content, consent, SEO/CSP/accessibility polish | §6, §10 | D3, D7, D12, D13 + client content | 3 |
| 13 | 5 | Staging deployment, runbooks, backups, go-live checklist, UAT | §6, §11 | D9, D10 | 2 |
| | | **Total** | | | **≈ 38 dev-days** (+20% contingency ≈ 46) |

**Critical path:** PR 0 → PR 1 → PR 3 (gated by **D1/D2**) → PR 4 → PR 5/6 → PR 7, then PR 8 → PR 9/10 → PR 13. PRs 2, 8 and 12 can run in parallel with the payment track once PR 1 has merged.

---

## 3. PR details

### PR 0: Repo foundation and CI
**Scope**
- `package.json`: add `devDependencies` (playwright, typescript, `@types/node`, supabase CLI), a lockfile, and `engines.node` with `.nvmrc` set to 22.
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
- Generate `types/database.ts`. Add a `db` job to CI that starts Supabase locally.

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

**Tests:**
- unit tests for the catalogue transform and cart quantity rules;
- a build test that fails if any generated file contains `product_assets` fields or storage paths (R4);
- updated e2e for J1, including the slug URLs.

**Acceptance:** J1 still passes on desktop and mobile; every product has a unique title and canonical URL and appears in the sitemap.
**Rollback:** revert. The previous static catalogue is restored by the revert.

### PR 3: Payment adapter and server-side checkout
*Blocked by D1 (gateway) and D2 (currency). Validate provider docs before coding (A4).*

**Scope**
- `netlify/functions/_lib/payments/{provider.ts, paystack.ts | stripe.ts}` implementing `createTransaction`, `verifyWebhook`, `lookupTransaction` and `parseEvent`.
- `checkout` rewritten as a v2 function with `config.rateLimit`. It:
  - validates input (schema);
  - loads published products and the coupon from the DB;
  - enforces coupon window, max redemptions and per-email limit;
  - computes the total server-side and inserts the `pending` order and items with a provider reference and a hashed access key;
  - initialises the transaction with the server amount and currency;
  - returns `409 price_changed` on an `expectedTotal` mismatch.
- **Remove the per-request coupon creation** from the prototype (G6).
- Cart page: an email field, a required terms checkbox and a separate, **unticked** marketing opt-in (G12, spec §4.3).
- `success.html` replaced by a status page that polls `/api/order-status` and shows a neutral "confirming" message (G3). It never claims success here, because that arrives in PR 4.
- A scheduled cleanup marks stale `pending` orders `expired`.

**Tests:** provider HTTP is mocked with recorded fixtures.
- **Tampering** (spec §7): modified price, discount, product ID, currency, quantity or `expectedTotal` cannot lower the charged amount; the amount sent to the provider always equals the DB computation.
- Unknown, draft or archived product → 400; expired or exhausted coupon → 400; rate limit → 429.
- A pending order is persisted **before** the provider call, and a provider failure leaves the order `failed`.
- e2e: cart to provider redirect (mocked); the status page shows neutral text.

**Acceptance:** J2 (payment initiation), spec §7 "Tampering" and "Failed or abandoned payment" (no paid order, no link, no success message).

### PR 4: Verified webhooks, idempotent confirmation, order status
**Scope**
- A `webhook-<provider>` v2 function. It reads the raw body, verifies the signature in constant time, inserts `payment_events` (deduplicated on `UNIQUE(provider, provider_event_id)`) and runs a **transaction lookup** via the provider API. It validates amount, currency, reference and live/test mode, then calls `confirm_payment(order_id, event_id)`.
- `confirm_payment()` (SQL, one transaction): pending → paid, and idempotently creates fulfilment rows and the email outbox row.
- Failed events are stored with the error.
- `scripts/replay-event.ts` (and later the admin button) safely re-processes them.
- `order-status` returns `{status, items:[{title, delivery summary}]}` only with a valid `ref` + `k`; the page now says "Payment received" only on `paid` and clears the cart then.

**Tests:**
- **Webhook replay** (spec §7): the same event POSTed 3 times gives one paid order, one fulfilment set and one outbox row.
- Bad signature → 401 with nothing written. Valid signature but lookup mismatch (amount, currency or reference) → event `failed`, order not paid.
- A test-mode event against a live-mode order is rejected.
- Out-of-order or concurrent duplicate events (parallel requests) still give one fulfilment, enforced by the DB constraint.
- Replaying a `failed` event after fixing the cause succeeds exactly once.

**Acceptance:** spec §7 "Checkout success" (exactly one paid order and one delivery set) and "Webhook replay", tested in **provider sandbox on staging** as well as with the mocked suite.

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

### PR 7: Refunds, chargebacks, cancellations
**Scope**
- Webhook handling for refund (full/partial), dispute opened/closed and abandoned/cancelled transactions, through the same verified, idempotent path.
- `record_refund()` revokes delivery tokens for the affected items and creates an `action_required` admin task for external access.
- Refund email.
- Financial rows are append-only.

**Tests:**
- **Refund** (spec §7): the refund is recorded, and an existing valid token is denied after the refund.
- A partial refund revokes only the refunded items.
- A duplicate refund event → one record.
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
- Actions, all audited: **resend delivery**, **revoke / renew links**, **mark manual access granted**, **replay failed event**, record a manual note.
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
- Netlify staging context and a separate Supabase staging project, all in provider **test mode**.
- `docs/runbooks/`:
  - deploy;
  - rotate keys;
  - backups and **restore drill**;
  - replay failed webhooks;
  - resend delivery;
  - refund handling;
  - incident response.
- Go-live checklist (spec §11), a UAT script mapping every J1–J7 journey and spec §7 test to manual steps, and a sign-off record.

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
