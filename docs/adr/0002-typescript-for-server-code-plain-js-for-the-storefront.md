# ADR 0002: TypeScript for server code; plain JS for the storefront

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
The spec asks for typed data models. Server code handles money, webhooks and access control, where type errors are costly.

## Decision
Netlify Functions and scripts are written in TypeScript with `strict` on. DB types are generated from the schema (`supabase gen types`). Browser code stays plain JS. The legacy JS checkout prototype is syntax-checked only until PR 3 replaces it.

## Consequences
`npm run typecheck` gates CI. Netlify bundles TS natively, so no extra build tooling is needed.
