-- PR 3 / migration 1 (ADR-0009): Payfast is the payment provider.
-- Separate file: Postgres cannot use a new enum value in the transaction that adds it.
alter type public.payment_provider add value if not exists 'payfast';
