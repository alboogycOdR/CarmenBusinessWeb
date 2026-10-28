# ADR 0003: Critical state transitions in Postgres functions

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
Payment confirmation, refunds and token issuance must be atomic and idempotent. The Supabase REST API cannot run several statements in one transaction.

## Decision
Implement `confirm_payment`, `record_refund` and `issue_delivery_tokens` as SQL functions called via RPC. Idempotency is enforced by unique constraints.

## Consequences
Correctness is guaranteed by the database even under concurrent webhook deliveries, and the functions are testable with SQL tests. Some business logic lives in SQL.
