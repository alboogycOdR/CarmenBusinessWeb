# ADR 0006: Catalogue in the database, published via build hook

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
J7 requires product changes without a code deployment, and SEO needs crawlable product pages.

## Decision
Products live in Supabase. The admin's "Publish" triggers a Netlify build that generates `catalog.js`, pre-rendered `/product/<slug>/` pages and `sitemap.xml`. Checkout always prices from the live DB.

## Consequences
Atomic deploys mean a failed build leaves the previous site live. A short publish delay is mitigated by `409 price_changed` at checkout.
