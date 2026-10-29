# ADR 0009: Payfast as the payment gateway; ZAR as the only store currency

- **Status:** Accepted (owner decision D1/D2, 28 October 2026)
- **Source:** [`../01-architecture-review.md`](../01-architecture-review.md) §3.1, §3.2, §6
- **Builds on:** [ADR-0007](0007-payment-provider-adapter.md) (provider adapter). This ADR fills in the provider; it does not supersede 0007.

## Context
The business is South African. Stripe is not a standard self-serve merchant country for South Africa, and the owner chose **Payfast**, settling in **rands**. Payfast's integration model differs from the webhook model assumed in the original plan (verified against Payfast's developer documentation, 28 Oct 2026):

- Checkout is a **signed HTML form POST** to `/eng/process`. The signature is MD5 over the fields in documented order, URL-encoded with upper-case escapes and `+` for spaces, salted with a merchant **passphrase**.
- Payment confirmation arrives as an **ITN** (form POST to `notify_url`) with `pf_payment_id`, `m_payment_id`, `payment_status` (`COMPLETE`; `CANCELLED` for subscriptions only) and `amount_gross`/`amount_fee`/`amount_net`. It is retried until a 200 is returned, but the **sandbox sends it once**.
- Payfast requires **four ITN checks**: signature, a valid Payfast source host (`www`, `w1w`, `w2w`, `sandbox.payfast.co.za`), an amount match, and a server confirmation POST to `/eng/query/validate` answered with `VALID`.
- There are **no refund or chargeback notifications**. Refunds go through the Refunds API (`GET /refunds/query/:id`, `POST /refunds/:id`, amounts in cents, bank details required for bank-payout methods) or the dashboard.
- **ZAR only**, with a **R5.00 minimum** transaction.

## Decision
1. Implement `PaymentProvider` for Payfast only: `buildCheckout` (signed form fields), `verifyItn` (the four checks, all required), and `refund` (query, then create, via the signed API).
2. Store currency is **ZAR**. PR 3 migrates the catalogue and seed to ZAR and adds a DB constraint so products, orders and coupons can only be in ZAR, plus `payfast` to the `payment_provider` enum.
3. ITN deduplication key: `provider_event_id = pf_payment_id || ':' || payment_status`, reusing the existing `UNIQUE(provider, provider_event_id)`.
4. The amount check is **exact in cents**. Payfast's sample code tolerates R0.01; we don't, because we generated the amount.
5. The source check uses the connecting IP from the platform (`x-nf-client-connection-ip`), **never** the `Referer` header used in Payfast's PHP sample, because a client can spoof it.
   *Amended in PR 4:* the connecting IP is checked against **Payfast's published server ranges** (docs, "Ports and IP addresses": `197.97.145.144/28`, `41.74.179.192/27`, `102.216.36.0/28`, `102.216.36.128/28`, `144.126.193.139`) **or** an address of the four hosts. The hosts alone are not enough, because they now resolve to inbound load balancers rather than the servers that send ITNs. If the ranges change, a notification is answered 403 and stored as failed. Payfast keeps retrying, and the event can be replayed (the signature and `VALID` confirmation are still required).
6. Refunds and chargebacks are **admin-initiated** actions that call `record_refund()` and revoke access in one transaction (see D15 for API vs dashboard).
7. Totals below R5.00 are rejected at checkout (D14).
8. Secrets: `PAYFAST_PASSPHRASE` and `PAYFAST_MERCHANT_KEY` live only in Netlify environment settings, separate for sandbox and live. Payfast's publicly documented sandbox test credentials are **never committed**; tests use obviously fake fixture values.

## Consequences
- **Positive:** a local gateway with ZAR settlement and familiar local payment methods. Server confirmation (`VALID`) gives a strong trust anchor despite MD5.
- **Negative:** refunds and chargebacks need human action (R15), and the PR 7 scope changes from webhook-driven to admin-driven. A real sandbox end-to-end test needs the public staging deploy (R16, D16). International buyers see prices in rands only.
- **Neutral:** the existing schema already supports this design. Only the enum value and the ZAR constraint are added in PR 3.
