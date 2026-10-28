## Scope
<!-- What changed and why. Reference the spec section(s) and backlog PR number. -->

## Out of scope (spec §9)
<!-- Confirm no student portal, LMS, video hosting, progress tracking, memberships, subscriptions, affiliates or platform enrolment APIs. -->

## Decisions / assumptions
<!-- Decision IDs (D1–D13) resolved or assumed, and any new assumptions. -->

## Acceptance evidence
| Criterion (spec ref) | How verified | Test name / screenshot |
|---|---|---|
| | | |

## Screenshots (UI changes)

## Migration and rollback

## Security checklist
- [ ] Inputs validated
- [ ] Authorization enforced in the function **and** by RLS
- [ ] No secrets or PII in code, logs or build output
- [ ] Rate limits on public endpoints
- [ ] Idempotency on side effects (payments, fulfilment, email)

## Reviewer checklist
- [ ] Tests are meaningful and CI is green
- [ ] Docs and runbooks updated
- [ ] No production change, no live payment settings touched
