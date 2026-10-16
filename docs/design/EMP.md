# EMP: employer seat pilot kit (design note and as-built)

Written 2026-10-16 on `feat/employer-seat-pilot`, cut from `origin/main-dev`. Founder decision (settled): "pilot kit on the existing employer platform". A seat-based Membership offer for a pilot employer, invoice payment for N seats, roster-code onboarding, an aggregate-only uptake report, pilot terms and a one-page ops runbook. Invariants: I8 no capitation, I9 institutions get aggregates only, INV-09 no stored balance, INV-15 integer kobo, individual enrolment only, naira only. Dormant: the `organisation_membership` platform module stays off and nothing here switches it on.

The live database was unreachable from this session (connection timeouts on every `execute_sql`), so everything below was read from the committed migrations, not from `pg_get_functiondef`. Items that depend on live state are listed at the end and in `docs/OPEN-QUESTIONS.md` (OQ-EMP-1..7).

## 1. What already exists (reuse, do not rebuild)

| Need | Already there | Where |
|---|---|---|
| Employer account, contract, locations, departments, verification, go-live | `employer_accounts`, `corporate_contracts`, `employer_go_live` | 20260829091959 |
| Roster, work-email/phone eligibility, invitations, bulk upload, cohort join code, claim, departure | `employer_roster_members`, `employer_invitations`, `employer_invite_roster_member`, `employer_accept_invitation`, `employer_join_with_code`, `employer_rotate_join_code`, `employer_bulk_upsert_roster`, `employer_mark_departed`, `claim_employer_roster_member` | 20260715162958, 20260829093043, 20260805184628 |
| Employer cannot read patients | `private.is_institution_admin()`, `is_org_staff` excludes `corporate_admin` and `hmo_admin`, `organisations.min_cohort_size` (default 10, CHECK >= 5), `isCohortSuppressed` | 20260729124330 |
| Benefit package that points at the Membership item | `employer_benefit_packages.catalog_item_id` (kind `membership`) | 20261013003317 |
| Organisation seat price (default 100,000 naira, per-organisation override, floor and ceiling from config, versioned) | `organisation_member_prices`, `private.organisation_member_price`, `set_organisation_member_price` | 20261013003317 |
| A claim grants a Membership seat (one per rostered member, replay safe by `entitlements_one_active_seat`, `patient_memberships.source = 'employer'`, "already a Member" is not billed) | `private.grant_org_seat`, `private.sync_employer_subscription_from_roster` | 20261013003317 |
| Seats billed in arrears to the organisation, per claimed seat | `public.generate_organisation_membership_invoice`, `employer_invoices`, `employer_set_invoice_status` (finance records settlement by hand, bank transfer against a PO) | 20261013003317, 20260829094237 |
| Counts and money only for an employer | `organisation_seat_summary` | 20261013003317 |
| Employer pages | `/dashboard/corporate/*` (roster, eligibility, billing, visits), `/admin/employers/[organisationId]`, `/finance/employer-billing` | apps/web |
| Platform gate | `platform_modules.organisation_membership` (off) | 20261013003317 |

So a rostered employee who claims DOES get a Membership entitlement today, billed to the organisation after the fact, one invoice per period for the seats claimed so far. Nothing sells a block of N seats up front, nothing caps seats, and the employer has no uptake report beyond counts of seats.

## 2. Gaps built here (and only these)

| Gap | Build |
|---|---|
| (a) A pilot offer: N seats, price from the organisation price in force (snapshotted), claim window, terms version, tied to the employer | `employer_seat_pilots` table, `employer_seat_pilot_config` (max seats, max window; PROPOSED, mirrored in `packages/shared/src/proposed-config`), RPC `create_employer_seat_pilot` (finance) |
| (b) Pay for the block, then seats are granted on claim | RPC `issue_employer_seat_pilot_invoice` (an `employer_invoices` row, status issued, `fixed_contract`) and `confirm_employer_seat_pilot_payment` (finance records a bank transfer or a Paystack payment link receipt; idempotent; activates the pilot; retro-grants seats for people who claimed while unpaid). `grant_org_seat` is extended: an organisation with a pilot is governed by it (no seat before payment, none past the purchased count, none outside the claim window); a pilot seat is born already attached to the pilot invoice, so the arrears invoice can never bill it twice. Unclaimed seats lapse at the window end (no refund; terms say so). `close_employer_seat_pilot` ends or cancels (cancel before payment voids the invoice) |
| (c) Onboarding | No new code: roster upload or code join (S03b) then claim. The pilot page shows the join code only to the employer admin (existing function) |
| (d) Aggregate report | `employer_seat_pilot_report(pilot)` SECURITY DEFINER: seats purchased, claimed, active, unclaimed; members who completed a consultation, members who logged a check-in; minimum cell (greater of the organisation's `min_cohort_size` and 5), complementary suppression (a cell is also withheld when "everyone except a few" would reveal them), figures cut off at the last completed Lagos week and rounded to the nearest 5, no names, no conditions, no readings, no per-person rows. CSV export of the same JSON only; printable page for PDF |
| (e) Terms and consent | `docs/legal/employer-pilot-terms-DRAFT.md` and `docs/legal/employee-pilot-notice-DRAFT.md`, marked needs counsel |
| (f) Runbook | `docs/runbooks/employer-pilot.md` |

Not built, deliberately: a new webhook kind for a Paystack link (OQ-EMP-1), a condition or programme uptake count (OQ-EMP-3), seat reuse after a departure (OQ-EMP-4), VAT on the invoice (OQ-EMP-6), any GL posting (OQ-EMP-2). No capitation, no per-employee card payment, no family plan, no stored balance.

## 3. Safety rules for this build
1. Employer reads nothing patient-scoped. The employer admin reads the pilot row and calls the report function; the report function counts rows it reads as definer and returns numbers only. No new policy admits `corporate_admin` to any patient table; `private.is_org_staff` is untouched.
2. Confirming payment twice produces one activation, one set of seats (`confirm` is a no-op replay; `entitlements_one_active_seat` still guards each person).
3. A seat is never billed twice: pilot seats are created with `invoice_id` already set to the pilot invoice, and the arrears generator only picks `invoice_id is null`.
4. A failure to grant a seat is visible: `seat_state` records `waiting_payment`, `no_seat_left` or `pilot_closed`, and an ops incident is raised once per roster row.
5. New objects start OFF: the module stays off, `grant_org_seat` still refuses when it is off.
