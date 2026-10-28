# ADR 0004: Outbox pattern for transactional email

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
An email outage must not affect a paid order (spec §7 "Email outage"), and the admin must be able to resend.

## Decision
Confirmation writes `email_events` rows in the same transaction. A scheduled worker sends them with retry, backoff and logging.

## Consequences
Delivery is eventually consistent, typically within seconds, and failures are visible and replayable.
