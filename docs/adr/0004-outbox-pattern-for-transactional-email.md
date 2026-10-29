# ADR 0004: Outbox pattern for transactional email

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
An email outage must not affect a paid order (spec §7 "Email outage"), and the admin must be able to resend.

## Decision
Confirmation writes `email_events` rows in the same transaction. A scheduled worker sends them with retry, backoff and logging.

## Consequences
Delivery is eventually consistent, typically within seconds, and failures are visible and replayable.

## Amendment (PR 6, 29 October 2026)
- **Provider: Resend, Free plan for launch (D9), with a revisit (D18).** Sender: `orders@<client's domain>` (D19). Setup and operations are in [`../email.md`](../email.md).
- **Workers lease due rows** (`FOR UPDATE SKIP LOCKED`, 5 minutes), so overlapping runs never double-send. Retries use exponential backoff (1 minute doubling, 10 attempts) and honour `Retry-After`. A permanent failure queues one admin alert.
- **The ITN sends a paid order's email inline** when it has time within Netlify's 10-second limit. The worker, scheduled every 2 minutes, is the safety net.
- **Download links are issued at send time**, fresh per attempt and never revoked by a retry: the worst case is a duplicate email, never a dead link. For the same reason there is no idempotency key, because Resend rejects a reused key whose content changed.

