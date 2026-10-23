# OQ-39: the analytics_* RPCs and test accounts (INV-13)

Status: migration `20261023175503_oq39_analytics_rpcs_exclude_test_accounts.sql` and proof `packages/db/tests/oq39_analytics_exclude_test_data.sql`. Not applied to live, not pushed.

## Problem
INV-13 says accounts flagged as test accounts are excluded from every metric. S02 added `profiles.is_test` and the convention "join `public.profiles` and filter `not is_test`", but the 56 older `public.analytics_*` RPCs (OQ-39, OQ-389) never got it. Live has 6 flagged profiles today; the exposure grows with every QA account.

## Inventory (read from LIVE `pg_proc`, 2026-10-23, not from migration files)
All 56 are `SECURITY DEFINER`, `search_path = ''`, ACL `{postgres, authenticated, service_role}` (read from `proacl`; anon none). Each begins with `private.is_analyst()`. There is no shared patient-level predicate in the database other than `profiles.is_test` itself (`private.real_patient_ids()` is an older `@tarragon.test` email heuristic, used by 6 of them).

| Class | Functions | Decision |
|---|---|---|
| Reads patient-bearing tables, 45 | accounting_summary, acquisition_funnel, active_users_timeseries, alert_burden, alert_quality, appointment_capacity, audit_summary, care_engagement_summary, clinical_outcomes, complaints_summary, deliverability, disease_surveillance, doctor_income, doctor_paid_jobs, doctor_performance, engagement_outcome_correlation, engagement_summary, escalation_quality, executive_summary, facility_engagement, feature_adoption, financial_summary, governance_summary, growth_timeseries, health_economics, investor_summary, operations_summary, population_summary, programme_funnel, provider_capacity, referral_turnaround, reputation_review_conversion, retention_cohorts, revenue_by_product, revenue_timeseries, safety_dashboard_summary, screening_referral_funnel, specialist_provider_performance, specialist_provider_workload, staff_activity, support_response_time, support_ticket_summary, traffic_summary, traffic_timeseries, user_segments | Re-created from the live body with relations redirected to the filtered views |
| Config, snapshot or gate only, 4 | business_summary (reads `analytics.rpc_snapshots`, refreshed by `private.refresh_analytics_snapshot_business_summary`, fixed here), finance_inputs, risk_register, population_dataset_preview (delegates to `get_geo_health_aggregates`, fixed here) | No body change |
| Record lookups and writers, 6, EXEMPT | patient_search, patient_activity, audit_log, log_patient_access, upsert_finance_input, upsert_risk | Unchanged on purpose: support and audit must find a test account's own rows. They return rows, not metrics. |
| Retired, 1 | clinical_rule_performance | Dropped (see below) |

## Decision
* **Central predicate, not 45 hand edits.** Schema `analytics_clean` holds 51 `security_invoker` views, one per patient-bearing relation the RPCs read. Each is the relation minus test accounts using exactly the S02 convention: `NOT EXISTS (select 1 from public.profiles tp where tp.id = t.<patient column> and tp.is_test)`, so a NULL patient or actor (an anonymous page view, a system audit row) is kept. Bodies are the live bodies with `public.<t>` or `private.<t>` replaced by `analytics_clean.<t>`: a pure text substitution. Signature, return type, volatility, `SECURITY DEFINER`, `search_path = ''` unchanged.
* `profiles`, `clinical_staff`, `facilities`, `pharmacy_orders` carry their own `is_test` and use it (staff and orders also through the patient/profile). `complaints` and `support_tickets` test both patient and creator. `audit_log` tests the actor and `subject_patient_id`. `real_patient_ids` is the old email heuristic minus `is_test` (the original function is left alone: it also drives notification features).
* **`commissions` and `payment_transactions`** have no patient or payer column (checked: `payment_transactions` has `booking_order_type/booking_order_id`, `subscription_id`, `raw_payload`, nothing else person-shaped), so the view resolves the patient through the order: service_purchase, lab, pharmacy, referral. `home_visit` (provider directory only) and `delivery` (removed in OQ-261) have no person-bearing source table and are kept. **Fail closed:** any other type value is excluded until it is mapped. The proof enumerates both enums and fails if a label is not in the view (A2), with a sabotage row proving it reports a new label.
* **ACLs.** Read from live `proacl` for all 58 functions: `{postgres, authenticated, service_role}`, including `get_geo_health_aggregates()` and `private.refresh_analytics_snapshot_business_summary()` (which is executable by `authenticated` today; an earlier draft of this migration wrongly revoked that, now restated exactly). Nothing is exposed through `analytics_clean`: no USAGE for anon or authenticated, asserted at the end of the migration.
* **Snapshot refresh** at the end of the migration is guarded by `to_regclass('analytics.rpc_snapshots')`, so a fresh replay without the table prints a notice instead of aborting.
* **Retired: `analytics_clinical_rule_performance`.** Counted first (live): no caller in `apps/`, `packages/`, `supabase/functions` on main-dev; none in any branch's apps code (history search); no cron job, view, policy or other function body names it; only `database.types.ts` lists it (entries removed in both type files). The migration repeats the dependency check before the drop and raises if anything references it. Its four `clinical_rule_*` views were therefore not created. **Kept, not dropped:** `analytics_health_economics` and `analytics_population_dataset_preview` have no main-dev caller but are called from apps code on the unmerged branch `origin/worktree-population-health-intelligence-gaps` (commits `b8723065d`, `79daf532b`), so dropping would break that branch if it merges; they are filtered instead.

Traps checked: every division in the bodies is already guarded (`nullif`, `case when ... = 0`, `greatest(count(*), 1)`), and every function returns an aggregate or a jsonb array, so an emptier input set changes counts, never the shape.

## Live body versus main-dev (review item 1)
The bodies were taken from live. For each of the 45 rewritten functions plus the two feeders and the exempt ones, the last `create or replace function` on `origin/main-dev` (rebased 2026-10-23, `f32cae87f`) was extracted and compared to the live body with whitespace and comments normalised.

* 53 of 58 (the 56 plus the two feeders: 58 compared) are identical to the last main-dev definition.
* 5 differ, and the difference is entirely `public.vitals_readings` in the migration versus `private.vitals_readings_current` / `private.vitals_readings_diagnostic` live: `analytics_clinical_outcomes`, `analytics_feature_adoption`, `analytics_programme_funnel`, `analytics_user_segments`, and the exempt `analytics_patient_activity`. The rewrite is done on main-dev itself by generic sweep migrations that patch function bodies at apply time: `20261013235037_s05b_c_read_filters_and_patient_guards.sql` (every body reading `public.vitals_readings` is moved to the `_current` view) and `20261016200822_bp_cuffless_estimates_never_diagnostic.sql` (a named list that includes `analytics_clinical_outcomes` and `analytics_programme_funnel` is moved to the `_diagnostic` view). Both are merged on main-dev, so the live body is what the main-dev chain produces. No unmerged branch's behaviour is shipped.
* 1 (`analytics_patient_activity`) is exempt and not touched at all.
* **Not verified:** I could not replay the main-dev chain (the local Supabase stack would not start), so "the chain produces the live body" is established by reading the two sweep migrations, not by running them.

## Performance (review item 5)
Local Postgres 17, 500k `vitals_readings`, 500k `web_events`, 220k `audit_log`, 20k profiles of which 10 flagged. `EXPLAIN (ANALYZE)` of the view against the base table:

| Relation | Plan of the anti-join | Base | Filtered |
|---|---|---|---|
| `web_events` (30 day count) | Hash Anti Join, hash of the 10 flagged profiles built once | 201 ms | 360 ms |
| `audit_log` (group by action) | two Hash Anti Joins (actor, subject), 10-row hash each | 420 ms | 619 ms |
| `vitals_readings_diagnostic` (latest BP per patient, as in `analytics_clinical_outcomes`) | Merge Anti Join against the sorted 10 flagged profiles | 890 ms | 1769 ms |

No nested loop and no per-row subplan: the flagged set is tiny and is hashed or merged once. The vitals case loses its parallel plan under the merge anti join and doubles; acceptable for a nightly or on-demand analyst query at this size, and the cheaper form (`not in (select id from profiles where is_test)`) would plan the same way. Revisit with the scale plan sizes. The proof itself cannot run on a database of this size: the 49 RPCs times three phases exhausted the container memory (killed by signal 9), so the proof ran on the small seeded database only.

## Changing a table behind an analytics_clean view (recipe)
The views are generated, not hand-written. `private.analytics_clean_view_sources` records, for every view, the relation it filters and the full select (predicate included). `private.rebuild_analytics_clean_views()` re-creates every view from that catalogue (idempotent, owner only, executable by no API role), and `private.drop_analytics_clean_views()` drops them all. Both are closed to anon, authenticated and service_role, as is the catalogue.

* **ADD COLUMN** on any table behind a view: add `select private.rebuild_analytics_clean_views();` after the `ALTER TABLE` in the same migration. Without it the RPCs cannot see the column.
* **DROP COLUMN or ALTER COLUMN TYPE** on such a table: Postgres refuses while a view uses the column. In the same migration, in this order: `select private.drop_analytics_clean_views();`, the `ALTER TABLE`, `select private.rebuild_analytics_clean_views();`. If the new column set breaks a predicate (for example the person column is renamed), edit the row in the catalogue first.
* **A new relation behind a new view:** insert its row in the catalogue (source and select, predicate with `profiles.is_test`), then rebuild. A new analytics_* function must read it through `analytics_clean.<name>`; the scan in `oq39_analytics_exclude_test_data.sql` enforces that.
* **Enforcement:** `packages/db/tests/oq39_analytics_clean_views_drift.sql` (in `ci.manifest`) fails when any source table has a column its view lacks, and prints the exact fix line (`select private.rebuild_analytics_clean_views();`). It carries a sabotage row (a column added to a real table is flagged, the fix clears it) and runs the DROP COLUMN / ALTER TYPE recipe on a fixture table: a direct `ALTER COLUMN TYPE` is refused with `0A000`, the drop, alter, rebuild sequence succeeds inside one transaction and the rebuilt view keeps the `is_test` filter. A view that exists without a catalogue row, or the reverse, also fails.

## Risk
* Column drift: a view freezes its column list. Handled, not just accepted: see the recipe below.
* Behaviour change: dashboards drop to zero test rows (intended).
* Not covered: `leads` (no account), the exempt lookups, and any direct table read outside these RPCs (the three `*_quality_metrics` views, OQ-39 part 2, are separate and unchanged).

## Regression guard
`packages/db/tests/oq39_analytics_exclude_test_data.sql` (in `ci.manifest`): A) catalogue scan fails on any non-exempt `analytics_*` function (or the two feeders) that reads a filtered relation directly or any other relation with a person column and no view; enum coverage for the commission and booking order types; B) a behavioural run over all 49 remaining jsonb RPCs (baseline holding one test patient, then a further test patient must change nothing, then a real patient: 46 outputs react, 3 are config-only); C) sabotage: an unfiltered probe function is caught, removing the filter from three views flips three RPCs, a new order type is reported.
