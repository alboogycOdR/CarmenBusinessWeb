# Handover: continue the CarmenBusinessWeb build

Paste everything below the line into a new Claude Code session that's opened on this repository.

---

You are continuing an in-progress project. Before you change anything, read this whole brief, then `docs/01-architecture-review.md`, `docs/02-implementation-backlog.md`, `docs/database.md` and `docs/adr/`. **Do not write code until the owner says which item to start.** They approve each pull request (PR) before work begins.

## 1. What the project is
- **Client:** Carmen, a South African author/coach who sells digital products (courses, e-books, guides, templates, bundles).
- **Goal:** a production-ready store that looks and feels like **https://www.mariawendt.com/** (a shop-first home page). Buyers check out as guests through **Payfast in rands (ZAR)**. After payment they automatically receive downloadable files, external course links, or both.
- **Scope authority:** *CarmenBusinessWeb Development Specification v1.0*, summarised in the docs above.
- **Repo:** `alboogycOdR/CarmenBusinessWeb`. Base branch: `main`.
- **Out of scope (spec §9):** LMS, student portal, video hosting, subscriptions.

## 2. Stack and architecture (decided; see `docs/adr/0001`–`0009`)
- **Storefront:** static HTML/CSS/vanilla JS. Not Next.js (ADR-0001).
- **Build:** `scripts/build.mts` reads the `public_catalog` view from Supabase with the anon key and writes `dist/`: pre-rendered `/product/<slug>/` pages, `catalog.js`, sitemap and robots (ADR-0006).
- **Database:** Supabase Postgres with default-deny RLS. Staff need an `admin_profiles` row plus MFA (aal2). Business logic lives in SQL functions (ADR-0003). Money is integer cents, ZAR only.
- **Server:** Netlify Functions in TypeScript (`netlify/functions/*.mts`, shared code in `netlify/lib/*.mts`). Node ≥ 22.18 runs `.mts` natively, with no bundler.
- **Payments:** Payfast (ADR-0009).
  - Checkout is a signed form POST (MD5 with the passphrase, fields in Payfast's documented order).
  - The payment notification (ITN) is trusted only after 4 checks: signature, source IP, exact amount, and server confirmation `VALID`.
  - Payfast sends no refund or chargeback notifications, so refunds are admin-initiated through Payfast's Refunds API.
  - Minimum transaction is R5.00.
- **Email:** Resend through an outbox with retries (ADR-0004).
- **Downloads:** opaque hashed tokens, exchanged for 60-second signed storage URLs (ADR-0005).

## 3. Status
**Merged to `main`:**
- #1 PR 0: repo foundation and CI.
- #2 PR 1: database schema, RLS, integrity rules, audit log, 160+ pgTAP tests.
- #3 GitGuardian false-positive fix.
- #4 Payfast/ZAR decision docs (ADR-0009).

- #5 PR 2: storefront built from the database, pre-rendered product pages, sitemap.

- #8: PR 3 (Payfast checkout) + UI polish, landed on `main` (main CI green at 7f5abbb).

- #9 PR 4: Payfast ITN (4 checks; source IP = Payfast's *published server ranges*), `process_payfast_itn()` + `confirm_payment()`, replay tool.
- #10 PR 5: private `product-files` bucket, download tokens (D5: 7 days, 5 downloads), `/api/download` (GET landing page, POST counts + 303 to a 60 s signed URL), `scripts/issue-download-links.mts`.
- #11 PR 6: email outbox + Resend (D9 Free plan, D18 revisit, D19 `orders@<client domain>`), one combined order email, inline send from the ITN + scheduled worker, `scripts/grant-manual-access.mts`, `scripts/preview-email.mts`, `docs/email.md`.

**Open:** nothing. **Owner to delete** stale branches `feat/02-catalogue-from-db`, `feat/03-payfast-checkout`, `feat/home-polish`, `feat/03-to-main`, `feat/04-payfast-itn`, `feat/05-secure-downloads`, `feat/06-email-delivery` (the session's git proxy refuses branch deletion with 403).

**Remaining backlog** (details in `docs/02-implementation-backlog.md`). Order: PR 8 → 7 → 9 → 10 → 11 → 12 → 13 (PRs 4–6 merged). **Next: PR 8 admin auth (needs D10: admin users, account ownership).**
- **PR 4:** Payfast ITN function (4 checks, dedupe `pf_payment_id:payment_status`) and `confirm_payment()` SQL (creates fulfilments, tokens and the outbox row idempotently), plus a replay tool. Extends `order-status` with items. **Needs D16** (Payfast sandbox account and a staging URL) for the real sandbox run; the fixture-based tests can be built without it.
- **PR 5:** private storage bucket, delivery tokens, `/api/download`.
- **PR 6:** Resend outbox, email templates, external and manual-access delivery, mixed delivery.
- **PR 8:** admin authentication with MFA and role checks.
- **PR 7:** admin-initiated refunds and chargebacks (Payfast Refunds API).
- **PR 9:** admin catalogue, asset upload, publish via build hook.
- **PR 10:** admin orders: resend, revoke/renew links, replay.
- **PR 11:** metrics and monitoring.
- **PR 12:** real content, consent, CSP, accessibility.
- **PR 13:** staging, runbooks, go-live checklist, user acceptance testing.

**Milestones:**
- **M1 Foundation:** done.
- **M2 Store on the database, with checkout and the polished look:** done (PRs 2–3 + polish merged).
- **M3 First real sale, paid and delivered:** code complete (PRs 4–6 merged); the sandbox purchase on staging waits for D16 + a staging site.
- **M4 Admin and operations:** PR 8, 7, 9, 10, 11.
- **M5 Launch:** PR 12–13, the client's content and the owner's sign-off.

## 4. Decisions
**Made:**
- D1 Payfast; D2 ZAR only; D11 branches `main`, `staging`, `feat/*`; D14 reject totals under R5.00; D17 prices shown as `R1 997.00`.
- Assumed: D6 no multi-seat products (quantity 1).

**Open:**
- D3 VAT and invoices.
- D4 product intake: files, links, prices, photos.
- D5 download expiry and limits (recommend 7 days, 5 downloads).
- D7 refund policy.
- D8 SAVE10 rules.
- D9 paid services and staging projects.
- D10 account owners and admin users.
- D12 newsletter provider.
- D13 real reviews.
- D15 refunds via Payfast API or dashboard.
- **D16 Payfast live and sandbox accounts.**

**Owner actions still pending:**
- Set the default branch to `main`.
- Add branch protection: 1 approval and 4 required checks.
- Mark GitGuardian incidents 39231395 and 39231396 as false positives.
- Netlify environment variables (see `.env.example`).

## 5. Look and feel (the owner's top priority alongside function)
- **Reference measurements matched in #7:** H1 Lora 64px / weight 500 (46px on mobile); body Roboto 18px (15px on mobile); buttons radius 4px, padding 12 × 34px, 15px; product tiles 1.54 ratio on light grey.
- Visual comparisons are done by screenshotting both sites with Playwright at the same viewports (1440 and 390) and measuring computed styles.
- **Still to reach full polish:**
  - real product photos or mockup images in her style (`products.images` overrides the SVG mockups);
  - Carmen's logo, if not a script wordmark;
  - real copy;
  - applying the same side-by-side treatment to the product, cart, reviews, free-resources and footer pages;
  - a staging deploy so the client can review and sign off.
- Never commit screenshots of the reference site (third-party imagery).

## 6. Working agreement
- **One backlog item per PR**, on its own `feat/<nn>-<slug>` branch. Use the PR template, including an **Acceptance evidence** table. Do not merge, deploy or change live payment settings.
- **Before every push:**
  - `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`, `npm run test:build`, `npm run test:e2e`;
  - gitleaks;
  - actionlint, when the workflow changes.
- **Mutation-test new safety tests:** break the protection on purpose and confirm the test fails.
- After opening a PR, subscribe to its activity and drive CI to green.
- **Attribution:** commits end with the `Co-Authored-By` / `Claude-Session` lines the session supplies; GitHub posts end with the Claude Code footer.

## 7. Environment setup and lessons learned
- **Start Docker first:** `nohup dockerd >/tmp/dockerd.log 2>&1 &`, then `npm ci`, then `npm run db:start` (local Supabase; Studio and others excluded).
- **CI builds need explicit env vars:** they must not fall back to `supabase status`, so CI runs `node scripts/supabase-env.mts >> "$GITHUB_ENV"`.
- **`[auth.email] enable_signup` must stay `true`:** setting it false disables staff login. Public signup is blocked by `[auth] enable_signup = false`.
- **Private functions used as column defaults need `GRANT EXECUTE` to `service_role`:** a column default runs as the inserting role.
- **Adding an enum value** needs its own migration file.
- **Supabase grants new `public` functions to anon/authenticated by default,** so always `REVOKE`. A pgTAP test asserts no RPC is callable by anon/authenticated.
- **pgTAP counts must be relative** (`tests.total_rows`), because local data accumulates.
- **GitGuardian** flags `password_requirements` next to SMTP examples, and password literals in tests.
- **Payfast docs are a JavaScript app:** render them with Playwright. PHP is installed; `tests/fixtures/payfast_signature_vectors.json` came from Payfast's own PHP code.
- **mariawendt.com:** WebFetch fails; use curl or Playwright.
- **Writing files:** never write a raw U+2028 character into source code; use escape sequences.

## 8. First steps in the new session
1. `git fetch`, then check `main` CI and any open PRs.
2. Report the status back to the owner in plain language.
3. Ask which to do next. The recommendation is to finish the merges, then PR 4 (ITN). If the owner prioritises the look, do the design pass on the remaining pages, or add real assets once Carmen supplies them.
