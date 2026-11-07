# Finance dashboard v2: audit and plan

Date: 2026-11-07. Source brief: "Finance and Revenue Dashboard" (founder, pasted in chat). Audited against `origin/main-dev` and the live database (`koiplnmbgnqnbywhpjlf`). Nothing has been built yet.

## 1. What already exists

The finance console is not a blank slate. It is a working double-entry accounting system with 21 pages under `/finance`, about 5,600 lines of UI and 4,400 lines in `lib/finance/`, and about 45 `finance_*` RPCs.

| Brief section | What exists today | Where |
|---|---|---|
| Overview KPIs | Cash, revenue YTD, unreconciled, deferred, receivables, VAT, WHT, prepayments; margins, growth, DSO, runway; cash vs promo split | `/finance`, `finance_dashboard_summary`, `finance_kpi_summary`, `finance_revenue_by_funding_source` |
| Revenue recognition | Deferral schedules, recognised vs deferred | `/finance/revenue`, `finance_revrec_summary` |
| Transactions | Per-patient lookup joining payment log to GL (needs an ID; not a directory) | `/finance/transactions`, `finance_unified_ledger` |
| Reconciliation | Flags sweep, settlement import and matching, money reconciliation snapshot, daily settlement tie-out | `/finance/reconciliation`, `/money-reconciliation`, `/settlement-tieout` |
| Refunds | Full state machine (`refunds`, `refund_status_events`, `refund-reconcile` edge function, provider confirmation before "completed", GL release, earnings reversal) | **Admin only**: `/admin/refund-requests` |
| Employer billing | Contracts, invoices, headcount billing | `/finance/employer-billing`, `employer_invoices` |
| Audit and controls | Finance audit log, maker-checker approvals with threshold, 13 granular `finance.*` permissions | `/finance/audit`, `/finance/approvals`, `/finance/settings` |
| Reports | Statements, tax, compliance calendar, printable audit/filings/investor packs | `/finance/statements`, `/tax`, `/compliance`, `/reports` |
| Fraud | Payment fraud signal sweep | `/finance/fraud` |
| Payables, budgets, cost centres | Vendors, bills, AP aging, budget vs actual | `/finance/payables`, `/budgets` |

Test data is already excluded from finance readers (`analytics_clean`, PR #1652).

## 2. Live data today

| Table | Rows | Real (non-test) |
|---|---|---|
| `payment_transactions` | 3 | 0 |
| `patient_memberships` | 2 | 1 granted, 1 test purchase on retired Plus |
| `refunds` | 0 | 0 |
| `employer_accounts` / `employer_invoices` | 0 / 0 | |
| `finance_settlements` | 0 | |
| `finance_journal_entries` | 16 | test |

Every new chart, trend and forecast will render empty until real payments arrive. This shapes the plan: build the views that are useful from the first payment, and hold the ones that need months of history.

## 3. Where the brief and the platform disagree

| Brief says | Platform fact | Proposed handling |
|---|---|---|
| Paystack and Flutterwave | Paystack is the only provider. Flutterwave was never integrated; Stripe was removed. | Build provider views generic over `provider`, showing Paystack only. No Flutterwave work. |
| Finance Viewer / Analyst / Officer / Manager / Administrator roles | CLAUDE.md: never add account roles. 13 `finance.*` capabilities already exist. | Ship the five as **permission presets** (named bundles of existing capabilities), not new roles. |
| Refund management in finance | Refunds live in `/admin/refund-requests`. | One place only (no duplicate workflow). Decision needed, see section 6. |
| ₦100k Membership, ₦90k employer seat, Plus retired | Matches T2-05 and T2-09. | No change. |
| Invoices for individuals | Individuals get receipts, not invoices. | Invoices stay employer-only, as the brief itself allows. |
| AI financial commentary | Every AI call must be registered in `ai_systems` and go through `runGovernedAi()`. | Deferred; would need a new registered system and approvals. |

## 4. Real gaps

1. **Shell.** Flat 20-item sidebar; no grouping, no pending counts, no shared reporting-period selector or comparison period, no glossary.
2. **Homepage.** No gross payment volume, refunds, net collections and recognised revenue shown side by side with definitions; no trend chart; no revenue composition by payer type (individual, employer, family sponsor); no payment success/failure view; no activity feed.
3. **Transaction directory.** No list across all payments with filters, sort, pagination and export; no transaction detail page with webhook history, refund and reconciliation timeline.
4. **Membership revenue workspace.** No view of paid Memberships, renewals, expiries, lapses, renewal rate with a stated denominator, or payer vs beneficiary.
5. **Family sponsorship revenue.** Care Voucher and gift payments are not shown as a revenue stream.
6. **Refunds in finance.** Finance staff cannot see refunds at all today.
7. **Provider performance.** No success rate, webhook failure or error view for Paystack.
8. **Global finance search (Cmd/Ctrl+K)** and a **finance exceptions panel** that does not clear on "read".
9. **XLSX export** (CSV and PDF exist in places; XLSX does not).
10. **Analytics that need history**: cohorts, lifetime value, forecasting, geographic split.

## 5. Proposed phases

Each phase is its own PR, reviewed with `/code-review high` (money class named explicitly), with Jest tests for every calculation and DB proofs for every new RPC.

- **Phase A: shell and homepage.** Grouped collapsible sidebar with counts, period selector with comparison, glossary of definitions, new homepage (the four money measures with definitions, trend chart, composition by payer type, payment performance, activity feed). New read-only RPCs only. Existing pages keep working.
- **Phase B: transactions.** Transaction directory (filters, saved filters, CSV/XLSX export behind `finance.export`) and transaction detail with timeline. No patient clinical data; payer and beneficiary by name and reference only.
- **Phase C: revenue workspaces.** Membership revenue, family sponsorship, employer revenue view on top of the existing employer billing; refunds view (per the decision in section 6).
- **Phase D: operations.** Provider performance, global search, exceptions panel, permission presets.
- **Phase E: analytics (held).** Cohorts, LTV, forecasting with stated scenarios. Built once there are at least three months of real payments; until then each would show nothing.

Nothing in A to D writes to a payment, membership or ledger row. Every new RPC is `SECURITY DEFINER`, checks `private.is_finance()`, reads the test-excluded views, and has `anon` execute revoked via `public`.

## 6. Decisions needed from the founder

1. Which phases to build now.
2. Refunds: move approval into finance, keep it in admin with a read-only finance view, or both roles approve in one shared page.
3. Whether to add a second-person rule for refunds above a threshold (the approvals machinery already supports thresholds).

## 7. Founder decisions (2026-11-07)

- **FIN-V2-1.** Build all phases, A to E. Phase E views (cohorts, LTV, forecasting) ship now and say plainly when there is not enough history, rather than drawing a chart from nothing.
- **FIN-V2-2.** Refunds get one shared workspace, opened and approved by admin and by finance staff holding the refund permission. No second workflow.
- **FIN-V2-3.** Refunds above a threshold need a second, different approver. The threshold is a setting in finance settings, using the existing approvals machinery.

## 8. Phase A review follow-ups (not fixed in the Phase A PR)

- **Event dates that can drift.** Refund-queue refunds (`service_purchase_refund_queue`, `voucher_refund_queue`) and failed orders have no dedicated "happened at" column, so the money-events view uses `updated_at`, which moves if the row is touched later. Fix in Phase C (refunds workspace): add `refunded_at` / `failed_at` stamped once by trigger and switch the view to them.
- **Query cost at scale.** One overview call reads the money-events view several times and resolves the legacy payer per row. Harmless at today's volume (zero real payments). Revisit with a single windowed CTE and timestamp-range predicates before volume grows; Phase B's transaction directory needs the same work.
- **Names beside care categories in the activity feed.** The feed shows the payer's name next to the stream (for example Pharmacy or Laboratory), as the existing transactions lookup already does. Decision for the founder as DPO: keep names on the overview, or show the reference only and keep the name for the record page.

## 9. Phase B review follow-ups (not fixed in the Phase B PR)

- **Refunds against legacy payments are not linked to their payment.** The directory's "refunded" amount and the detail page's refund list cover v5 checkout orders only. Lab, pharmacy, doctor-service and Care Voucher refunds appear as their own rows but are not tied back to the original Paystack charge. Fix with the shared refunds workspace (Phase C), which needs that link anyway.
- **The detail reads the whole money-events view to find one record.** Fine at today's volume; read the source table for the record type directly before volume grows (same work as section 8's query-cost item).
- **Decision taken (FIN-V2-4, for the founder to confirm):** every directory read that returns named rows is written to audit_log (`finance.transactions.listed`), not only exports, so a view-only member paging through the list is as traceable as an export.

## 10. Phase C1 decisions and follow-ups

Decisions taken in C1 (for the founder to confirm):
- **FIN-V2-5.** Only an admin can set or clear the second-approver threshold, with a reason that is logged. The finance staff the rule binds cannot switch it off themselves.
- **FIN-V2-6.** A patient's own free-text refund reason is shown only to people who can decide refunds, because patients often explain a refund with health details. View-only finance staff see amounts, names and states.
- **FIN-V2-7.** With no threshold set, one approval is enough, exactly as before. The founder is the only approver today, and a missing setting must never leave a patient's refund stuck. Once a refund holds a first approval, it always needs a different second approver, even if the threshold is later cleared.

Follow-ups:
- Nobody is notified when a refund is waiting for a second approver; the workspace highlights it and the sidebar badge counts it. A notification to other approvers is worth adding once there is more than one.
- The admin-only retry/settle panel still loads the old pending list it no longer shows (one wasted query per admin visit).

## 11. Phase C2 notes and follow-ups

- Memberships redeemed from a Care Voucher are counted apart, not as paid, on both the overview and the Membership page (the voucher may be a reward). A bought voucher's money is counted when the voucher is paid for.
- **Employer invoices are not split by what they bill.** `employer_invoices` has no item type, so a screening-day invoice and a Membership-seat invoice both count as employer Membership revenue. The Membership page labels the line "Employer invoices paid". Fix: add an invoice purpose (seats / screening / other) when employer billing next changes.
- The new Membership, sponsorship and employer reads are not limited to the caller's organisation: an employer Membership belongs to the employer's organisation, so a caller-organisation filter would hide it. Revisit if a second Tarragon tenant ever exists.
- Employer revenue repeats a renewal-date lookup per employer; fine at today's handful of employers.
