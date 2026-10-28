# ADR 0005: Opaque download tokens exchanged for short-lived signed URLs

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
Files must stay private; links must expire and be revocable and renewable (J6).

## Decision
Emails carry `/api/download/<token>`. Only a SHA-256 hash of the token is stored. A valid token yields a 60-second storage signed URL via a 302 redirect.

## Consequences
Permanent storage URLs never appear in HTML, JS or email. Downloads can be counted and revoked.
