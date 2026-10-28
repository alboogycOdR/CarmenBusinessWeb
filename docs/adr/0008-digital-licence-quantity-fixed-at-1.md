# ADR 0008: Digital licence quantity fixed at 1

- **Status:** Accepted (approved with the architecture review, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §5

## Context
Spec §4.1: default quantity to one unless multi-seat purchasing is defined.

## Decision
The cart caps each product at 1 and hides the quantity control unless a product sets `allow_quantity`.

## Consequences
Prevents accidental multi-purchases. Multi-seat can be enabled per product later (D6).
