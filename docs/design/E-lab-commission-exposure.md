# Track E: lab, screening and therapy commission exposure (spec 8.16)

Safety fix, same class as the S53 pre-fix on `pharmacy_medications` (commit `cbbbf4a64`, migration `20261007002834`). Migration:
`20261007105817_e_lab_screen_therapy_commission_columns_off_the_authenticated_surface.sql`. Proof:
`packages/db/tests/e_lab_screen_therapy_commission_columns_not_readable.sql`. Scan test:
`apps/web/src/lib/queries/lab-commission-columns.scan.test.ts`.

## The problem, with live counts (read-only, 2026-10-07)

| Table | Rows | Rows with a commission | Exposed columns | Who could read |
|---|---|---|---|---|
| `lab_tests` | 60 | 10 | `commission_rate`, `commission_rate_type`, `commission_flat_kobo` | every signed-in user (`using (true)`, table-wide grant) |
| `panel_bundles` | 42 | 6 | same three | every signed-in user |
| `screen_types` | 38 | 21 | `commission_rate` | every signed-in user |
| `therapy_sessions` | 0 | 0 | `commission_kobo` | the patient, and clinicians via `staff_may_read` |

Nothing in the app showed these, but the API did: a patient could read what Tarragon earns on each test.

## Wider sweep (every table with commission, margin, partner-cost columns)

Safe already: `specialist_providers` (select policy is admin or `partners.specialists.manage`; `specialist_directory` and
`therapy_directory` are owner-run views with no commission column), `lab_providers` and `pharmacy_partners` (narrowed 2026-09-25),
`earnings_ledger` (own clinician or admin), `platform_finance_inputs` (no authenticated SELECT), `service_product_margins`
(security invoker over finance-only sources).

Found, NOT changed here (OQ-320): `lab_orders.partner_cost_kobo/_provider_id/_breakdown`, `pharmacy_orders.partner_cost_*`,
`lab_order_refunds.margin_portion_kobo`, `pharmacy_order_refunds.margin_portion_kobo`. All four tables have 0 rows today. The
ordering patient and any org staff can read them (`select *` is still used on these tables). Needs the same treatment and a wider
client sweep; recommended as the next track. Also still open until the S53 pre-fix is applied live: `pharmacy_medications` and
`commissions` (the ledger policies admit the clinician role through `is_org_staff`).

## The fix

For each of the four tables: revoke table-level SELECT from `authenticated` and `anon` (a column REVOKE is a no-op under a table
grant), grant SELECT on the safe column list. A column added later is not readable until someone adds it to the grant. The
migration ends with an assertion block that also fails if any column is unreadable but is not a deliberate commission omission, so a
stale list cannot ship. Full rows for admin, partner managers (`partners.labs.manage`) and finance (`commissions.view`) come from
owner-run views `lab_tests_admin`, `panel_bundles_admin`, `screen_types_admin` (predicate in the view; everyone else gets zero rows).
No therapy admin view: no client reads that column, and the `commissions` ledger carries the figure for finance. Row policies are
unchanged.

## Callers inventory (all apps, packages, edge functions)

- Every function that names a commission column is SECURITY DEFINER with `search_path = ''` (8 of 8: `record_lab_commission`,
  `record_pharmacy_commission`, `record_referral_commission`, `post_therapy_commission`, `enforce_therapy_session_rules`,
  `compute_pharmacy_partner_cost`, and the two partner-edit restriction triggers). No SECURITY INVOKER function and no view
  references the four tables by commission column; `patient_care_gaps` reads only `name`.
- Edge functions and `services/ml`: no reads of these tables.
- Client reads changed from `select("*")` to explicit columns: web `useLabCatalogue`, `useLabPartnerOwnTests`,
  `useMyTherapySessions`, the therapy-approvals queue; mobile `loadLabPanelBundles`, `loadMyTherapySessions`. Web admin
  `useAllPanelBundles` now reads `panel_bundles_admin`. About 30 other reads and embeds already named safe columns.
- Found by the review: `public.approve_therapy_session` (SECURITY DEFINER) returned the whole `therapy_sessions` row, so a clinician
  calling it got `commission_kobo` back. It now returns `void` (same body, same grants, drop and recreate); its only caller ignores the
  body. It was the only public function returning one of the four row types or doing `returning *` on them.
- Writers unchanged: admin and partner-manager commission edits and the lab partner `is_active` toggle are plain UPDATEs with no
  RETURNING; the patient therapy INSERT is filled in by the BEFORE INSERT trigger (proved in the DB script).
- Types: `PanelBundle`, `LabTestRow`, `TherapySession` are now `Omit<..., commission columns>`; the admin screen keeps the full type.

## Apply order (ship the code first)

1. Merge and deploy the web app (Vercel production = main-dev) with this PR's client changes.
2. Publish the mobile JS update (OTA, `preview` channel; JS only, no native change). Old installed mobile builds still call
   `select("*")` on `panel_bundles` and `therapy_sessions` and will get a permission error on those two reads after step 3, so
   wait for OTA adoption or accept a short gap on the lab booking and therapy lists (OQ-321).
3. Apply the migration. It is safe to apply after the code is out and is idempotent-enough to roll back by re-granting table SELECT.

## Proof

137 checks. Per role (patient, clinician, pharmacist, lab_partner, lab_liaison, analyst, corporate_admin, hmo_admin, finance with and without
`commissions.view`, partner manager, admin, anon): commission columns refused, `select *` fails loudly, price/name/active
readable, admin views empty except for the three privileged roles, writers still work, and a sabotage step restores the table
grant and the leaks must reappear.
