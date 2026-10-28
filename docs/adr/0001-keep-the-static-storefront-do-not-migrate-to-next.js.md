# ADR 0001: Keep the static storefront; do not migrate to Next.js

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
The storefront (HTML/CSS/vanilla JS) already satisfies J1, is fully tested (unit + Playwright) and is fast. Every gap against the specification is in the backend, admin or SEO.

## Decision
Keep the static storefront and extend it with Netlify Functions, a vanilla-JS admin SPA and a small pre-render build step.

## Consequences
No rewrite or re-test of working UI, and no new framework for the client to maintain. Revisit only if dynamic SSR personalisation or a catalogue of more than a few hundred products is required.
