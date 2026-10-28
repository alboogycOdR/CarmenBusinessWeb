# ADR 0007: Payment provider adapter

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
The gateway is undecided (D1). South Africa is not a standard Stripe self-serve country.

## Decision
Define a `PaymentProvider` interface (`createTransaction`, `verifyWebhook`, `lookupTransaction`, `parseEvent`) and implement the chosen provider first.

## Consequences
Provider-specific code is isolated to about one file each, and PR 0–2 are not blocked by D1.
