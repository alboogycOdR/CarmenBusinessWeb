# Carmen Business Web

A fast, dependency-free static storefront for selling **courses, books, workbooks and bundles**, modelled on a shop-first author/coach site: the home page *is* the shop.

| Feature | Where |
|---|---|
| Shop with search, price range, category filters, sort, pagination (filters live in the URL, so they are shareable) | `index.html` |
| Product page: quantity, Add to cart, optional Buy now, tabs (Description / Additional information / Reviews), related products, `Product` + `AggregateRating` JSON-LD | `product.html?id=...` |
| Cart drawer + cart page, quantities, remove, discount codes, persistent across visits | all pages, `cart.html` |
| Real checkout (Stripe) via a tiny serverless function, plus a no-server fallback | `netlify/functions/checkout.js`, `success.html` |
| Reviews page: rating summary, distribution bars, search, sort, pagination | `reviews.html` |
| Free resources / lead magnets, About, Contact, Terms, Privacy, 404 | `free.html` `about.html` `contact.html` `terms.html` `privacy.html` `404.html` |
| "10% off your first order" newsletter popup that auto-applies the code | `popup` in config |
| Dark mode, mobile menu, skip link, keyboard-accessible tabs/dialogs, reduced motion | everywhere |

## 1. Edit the content (no code needed)

Everything is in **`assets/js/site-config.js`**: brand, announcement bar, nav, shop intro, products, reviews, free resources, about text, discount codes and popup. Placeholder copy, prices and reviews **must be replaced** with the client's real content (and the Terms/Privacy templates reviewed by a professional).

Add a product by copying an entry in `products`: unique `id`, `type` (`course` | `book` | `bundle`), `price`, optional `compareAt` (shows "Save n%"), `tags` (extra filter categories), `badge`, `included`, `info` (the "Additional information" table). Product mockups: drop images in `assets/img/` and set `image: "assets/img/my-course.webp"`; blank = a generated cover using `color`.

Re-brand by editing the `:root` tokens at the top of `assets/css/styles.css` (`--brand` is the accent colour) and the logo text/script font.

## 2. Take payments

Pick one (or combine):

**A. Cart checkout with Stripe (recommended).** Deploy to Netlify, set two environment variables, and point the site at the function:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` while testing, `sk_live_...` to go live |
| `SITE_URL` | `https://your-domain.com` |

Then in `site-config.js` set `checkout.endpoint: "/.netlify/functions/checkout"`. The browser sends only product ids, quantities and a code; **prices and discounts are re-computed on the server from the same config file**, so they cannot be tampered with. Discount codes become single-use Stripe coupons. After payment Stripe returns the buyer to `success.html`, which clears the cart.

Fulfilment (emailing course access/downloads) is not included: use a Stripe webhook into your course platform/email tool, or Stripe's receipt email with a link to the member area. Tell the client to decide this before launch.

**B. Hosted links, no server.** Set a product's `checkoutUrl` (Stripe Payment Link, PayPal, Gumroad, Teachable...). The product page gains a **Buy now** button, and with no `checkout.endpoint` the cart offers a "Pay for ..." link per item plus an "Email my order" option.

## 3. Forms

Set `brand.formEndpoint` to a Formspree/Basin/ConvertKit-style endpoint that accepts a JSON POST (`{name, email, message}`). Blank = forms open the visitor's email app addressed to `brand.email`.

## 4. Develop, test, deploy

Requires Node 22 (`.nvmrc`). Dependencies are pinned exactly and locked.

```bash
npm ci                 # install the exact locked toolchain
npm start              # http://localhost:8080
npm run typecheck      # strict TypeScript for server code (ADR-0002)
npm test               # unit, content/link, checkout-function and repo guard-rail tests
npm run test:e2e       # Playwright browser scenarios
npm run check          # all of the above
```

`SHOTS=/some/dir npm run test:e2e` also saves full-page screenshots at desktop and mobile widths. On a fresh machine, run `npx playwright install chromium` once.

### Continuous integration

Every pull request, and every push to `main` or `staging`, runs `.github/workflows/ci.yml`. Any red job blocks merge once branch protection is enabled.

| Job | Gate |
|---|---|
| Typecheck, unit tests, audit | `tsc`, `node:test` suites, `npm audit --audit-level=high` |
| End-to-end | Playwright on Chromium; screenshots uploaded as a build artifact |
| Secret scanning | gitleaks over the **full git history** (binary checksum-verified) |

Actions are pinned to commit SHAs, and Dependabot proposes updates weekly (npm) and monthly (actions). Secrets never go in the repo: `.env.example` lists every variable, and real values live only in Netlify environment settings, separate for test and live.

### Branches and pull requests

`main` is the protected base, `staging` deploys to the staging context in payment test mode, and each backlog item gets its own `feat/<nn>-<slug>` branch. Every PR uses `.github/pull_request_template.md`, including an **Acceptance evidence** table. Plans and decisions are in [`docs/`](docs/), with ADRs in [`docs/adr/`](docs/adr/).

## Layout

```
index.html product.html cart.html reviews.html free.html about.html contact.html success.html terms.html privacy.html 404.html
assets/css/styles.css      design tokens + styles
assets/js/site-config.js   ALL content (also read by the checkout function)
assets/js/lib.js           pure logic: filtering, cart maths, reviews, URL safety (unit-tested)
assets/js/main.js          rendering + interactions
netlify/functions/checkout.js   Stripe Checkout session builder (unit-tested with a mocked Stripe)
tests/                     site.test.js, checkout.test.js, repo.test.js, e2e.js
docs/                      architecture review, backlog, ADRs
.github/                   CI workflow, Dependabot, PR template
```

## Design notes and trade-offs

- Cart contents and the discount code live in the visitor's `localStorage`; the popup's code is public by design (a first-order incentive). Only the server function decides what is actually charged.
- Content is rendered client-side from the config. Google indexes it (and product pages emit JSON-LD), but if SEO becomes critical add a small pre-render step that reuses `site-config.js`.
- All user-visible config text is HTML-escaped; checkout/image/social URLs are restricted to `http(s)` or relative links.
