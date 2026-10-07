# Track G: partner cost and refund margin exposure (spec 8.16, closes OQ-320)

Safety fix, same class as Track E (`docs/design/E-lab-commission-exposure.md`, PR #1021) and the S53 pre-fix on
`pharmacy_medications` (commit `cbbbf4a64`). Migration: `20261007190500_g_partner_cost_and_refund_margin_columns_off_the_authenticated_surface.sql`.
Proof: `packages/db/tests/g_partner_cost_columns_not_readable.sql`. Scan test: `apps/web/src/lib/queries/partner-cost-columns.scan.test.ts`.

## The problem, with live counts (read-only, 2026-10-07, project `koiplnmbgnqnbywhpjlf`)

| Table | Rows | Exposed columns | Who could read |
|---|---|---|---|
| `lab_orders` | 0 | `partner_cost_kobo`, `partner_cost_breakdown` (what Tarragon owes the laboratory, per test) | the ordering patient, a caregiver with `labs_results`, every `is_org_staff` user (admin, clinician, care coordinator) |
| `pharmacy_orders` | 0 | `partner_cost_kobo`, `partner_cost_breakdown` | the ordering patient, every `is_org_staff` user |
| `lab_order_refunds` | 0 | `partner_portion_kobo`, `margin_portion_kobo` (how a refund splits between partner liability and Tarragon loss) | the patient of the order, every `is_org_staff` user |
| `pharmacy_order_refunds` | 0 | same two | same |

All four had a table-wide `SELECT` grant for `authenticated`, so `select *` returned the figures. Nothing leaked (zero rows), and
nothing in the app reads these columns by name; the exposure was `select("*")` and the API itself. This is the last chance to close
it before the first real partner order.

`partner_cost_provider_id` (which laboratory or pharmacy fulfils the order) is deliberately NOT withheld: it is not an amount, the
patient already sees the provider, and `lab_orders_awaiting_transmission` joins on it.

## Wider sweep (every column in `public` matching partner_cost, margin, commission, payable, cost, settle, payout, fee)

Fixed here: the four tables above, plus three leaks the sweep found around them.

1. `public.lab_orders_awaiting_transmission` (security invoker view) selected `partner_cost_kobo`. It would have errored for every caller
   after the revoke. Recreated without that column (nothing reads it from a client; one DB proof does, on `id`).
2. Three SECURITY DEFINER functions returned the whole `lab_orders` row, so the API response carried `partner_cost_*`:
   `request_lab_order_partner_visit` (any patient), `set_lab_order_facility` (patient or staff), `assign_home_phlebotomist` (staff or
   the owning lab partner). They now return `void`. The only client caller ignores the body. A catalogue query over `pg_proc` found
   no other function in `public` or `private` returning one of the four row types, and the migration ends with that same check as an
   assertion. `set_referral_specialist_provider` returns a `specialist_referrals` row, which has no partner cost (see below).
3. `request_lab_order_refund` and `request_pharmacy_order_refund` (SECURITY DEFINER, callable by any `is_org_staff` user, so a clinician)
   returned `released_from_liability_kobo`, `tarragon_loss_kobo` and the policy note. Those keys are now present only for admin or a
   holder of `commissions.view`. No client calls them.

Checked and left alone, with the reason:

| Object | Finding |
|---|---|
| `partner_statements`, `partner_statement_lines`, `pharmacy_partner_statements`, `pharmacy_partner_statement_lines` | `invoiced_total_kobo` / `expected_*` are what a partner invoices Tarragon. Policy is `private.is_org_staff` (care-team operations record partner invoices by design, see `apps/web/src/lib/finance/partner-statement-access.ts`). No patient or caregiver path, 0 rows. Narrowing it is a product decision (OQ-330). |
| `match_partner_statement`, `match_pharmacy_partner_statement` | Return invoice totals the caller can already read in the table. Same OQ-330. |
| `specialist_referrals.referral_fee_kobo`, `payable_kobo` | The patient price (copied from the specialist consultation fee). Not a partner cost. |
| `lab_providers.cost_basis*` | Select policy is admin or `partners.labs.manage`. |
| `service_product_margins` | Security invoker over `service_delivery_cost_model` and `clinical_tier_cost_rates`, both admin-only. |
| `lab_refund_policies.partner_still_owed`, `pharmacy_refund_policies.partner_still_owed` | A boolean per refund reason, readable by every signed-in user. Reveals policy, not an amount (OQ-331). |
| `home_visit_providers.home_visit_fee_kobo`, `logistics_partners.delivery_fee_kobo`, `pharmacy_partners.delivery_fee_kobo` | The fee a patient is shown for the service. |
| `payments.fee_kobo` | The payment-processor fee on a payment. Not a partner cost; not looked at further here. |
| `commissions`, `pharmacy_medications` | Fixed by the S53 pre-fix (`20261007002834`), not applied live yet. See apply order. |
| `lab_tests`, `panel_bundles`, `screen_types`, `therapy_sessions` | Fixed by Track E (`20261007105817`), not applied live yet. |
| Realtime | None of the four tables is in a publication (live `pg_publication_tables` is empty); Realtime does not apply column privileges, so the migration asserts this stays true. |

Observation, not changed: `lab_order_refunds.detail` / `pharmacy_order_refunds.detail` is a free-text staff note that the patient can
read on their own refund (OQ-332).

## The fix

For each of the four tables: revoke table-level `SELECT` from `authenticated` and `anon` (a column `REVOKE` is a no-op under a table
grant) and grant `SELECT` on every column except the withheld ones. The column list is computed from `pg_attribute` at apply time, so
columns that other in-flight branches added to the live table are granted too. A column added later is not readable until someone
grants it (the intended default, and the proof fails if a later migration forgets). Row policies, `INSERT`/`UPDATE`/`DELETE` grants
and every writer are unchanged.

No admin or finance view is added. Track E needed views because the admin catalogue screens edit commission rates; here no client or
screen reads these columns at all (the cost is written by `compute_pharmacy_partner_cost`, `set_lab_order_computed_price`,
`snapshot_pharmacy_order_partner_cost`, the never-sell-below-partner-cost triggers, `request_*_refund`, `approve_*_refund`,
`match_*_statement` and the finance posting functions, all SECURITY DEFINER with `search_path = ''`, which run as the owner and are
not affected by the revoke). If finance later needs a screen, add an owner-run view (`security_invoker = false`, predicate
`private.is_admin() or private.has_permission('commissions.view')`) in that PR.

## Callers inventory (web, mobile, console, packages, edge functions, services)

- Scanned every `.from("<table>")` and every embed of the four tables, plus `lab_orders_awaiting_transmission`, in `apps/`, `packages/`,
  `supabase/functions/` and `services/`. Names of the withheld columns appear in no client code, edge function or ML service.
- `select("*")`-class reads changed to explicit columns: web `useOrgLabOrders` / `usePatientLabOrders` (the shared `LAB_ORDER_SELECT`
  started with `*`), `usePatientPharmacyOrders`, `useOrgPharmacyOrders`. Types `LabOrderWithDetails` and `PharmacyOrder` are now
  `Omit<..., withheld>`. All other reads (about 30, including every embed) already named safe columns. Mobile names its columns
  everywhere (`LAB_ORDER_SELECT`, `PHARMACY_ORDER_SELECT`).
- Two places where a failed read used to look like "no orders" now say so and pause the action: the clinician order form
  (duplicate-test check) and the patient health-check booking (already-open check) show an alert on `isError` and disable the
  submit button instead of silently carrying on.
- Both generated type files (`packages/shared/src/database.types.ts` and `packages/db/src/database.types.ts`) were edited by hand (not regenerated, see CLAUDE.md): removed `partner_cost_kobo` from the view Row, and the three
  functions now return `undefined`.

## Known limits (from the review)

- A holder of `commissions.view` still receives the cost split from the two refund RPCs. That is the same permission that already
  opens the commissions ledger and is meant for finance. If it is ever granted to a clinician account, that clinician sees partner
  economics. Grant it to finance and admin only.
- The client column lists are copies of the grant list (a Jest drift test compares them with the generated types, not with live).
  Moving the cost columns to a finance-only side table (OQ-320 option b) would remove both lists but is a larger schema change;
  OQ-334 records the trade-off.

## Old clients (OQ-321 style)

| Old build | Read | After the migration | Visible? |
|---|---|---|---|
| Old web bundle in an open tab (before deploy) | `lab_orders` and `pharmacy_orders` lists (`*`) | permission error 42501 | Yes: `listQueryState` shows the error state on the patient lab list, patient pharmacy list and clinician orders page. No: the health-check booking and clinician order form lost their duplicate checks silently (fixed in new code; an old tab keeps the old behaviour until reloaded). |
| Old mobile builds | none of these reads used `*` | unaffected | n/a |
| Old web or mobile calling the three void functions | response body ignored | unaffected | n/a |

## Apply order

1. Merge and deploy the web app from this PR (Vercel production = main-dev). Code first: the new reads name their columns, which
   works against the old schema too.
2. Mobile needs no OTA for this change (no mobile edit).
3. Apply this migration. **Do not use `apply_migration`**: it stamps wall-clock time, which is earlier than this file's version, so
   the live ledger and the file would disagree and a replay would order it differently. Run the file with `execute_sql` in one
   transaction and pin `supabase_migrations.schema_migrations.version` to `20261007190500`. That version is deliberately later than
   the newest live version (`20261007190000`) so a fresh replay grants every column other migrations added first (the first draft,
   stamped at wall-clock time, missed `pharmacy_orders.is_test` from S28d). It is independent of Track E (#1021) and of the S53 pre-fix (#1002): different tables, no shared objects, any
   order is safe, and it sorts after Track E's file. The only shared files are `apps/web/src/lib/queries/lab-orders.ts` and
   `pharmacy-orders.ts`, where this PR and the other two touch different lines (expect a trivial textual merge, not a logic one).
   Recommended: all three live before the first real partner order.

## Proof

`g_partner_cost_columns_not_readable.sql`, registered in `ci.manifest`: per role (patient, caregiver-style other patient, clinician,
pharmacist, lab_partner, lab_liaison, analyst, corporate_admin, hmo_admin, finance with and without `commissions.view`, admin, anon)
every withheld column is refused, `select *` fails loudly, safe columns stay readable, the writers still work, the refund RPC response
carries the cost only for admin or `commissions.view`, the three functions return void, and a sabotage step restores the table grant
and the leaks must reappear.
