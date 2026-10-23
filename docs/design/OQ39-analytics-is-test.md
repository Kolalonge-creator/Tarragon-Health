# OQ-39: the analytics_* RPCs and test accounts (INV-13)

Status: migration `20261023175503_oq39_analytics_rpcs_exclude_test_accounts.sql` and proof `packages/db/tests/oq39_analytics_exclude_test_data.sql`. Not applied to live, not pushed.

## Problem
INV-13 says accounts flagged as test accounts are excluded from every metric. S02 added `profiles.is_test` and the convention "join `public.profiles` and filter `not is_test`", but the 56 older `public.analytics_*` RPCs (OQ-39, OQ-389) never got it. Live today there are 6 flagged profiles, so the exposure is small, and it grows with every QA account.

## Inventory (read from LIVE `pg_proc`, 2026-10-23, not from migration files)
All 56 are `SECURITY DEFINER`, `search_path = ''`, EXECUTE for `authenticated` and `service_role` only (anon: no). Each begins with `private.is_analyst()`. There is no shared patient-level predicate in the database other than `profiles.is_test` itself (`private.real_patient_ids()` is an older email heuristic, `@tarragon.test` only, used by 6 of them).

| Class | Functions | Decision |
|---|---|---|
| Reads patient-bearing tables, 46 | accounting_summary, acquisition_funnel, active_users_timeseries, alert_burden, alert_quality, appointment_capacity, audit_summary, care_engagement_summary, clinical_outcomes, clinical_rule_performance, complaints_summary, deliverability, disease_surveillance, doctor_income, doctor_paid_jobs, doctor_performance, engagement_outcome_correlation, engagement_summary, escalation_quality, executive_summary, facility_engagement, feature_adoption, financial_summary, governance_summary, growth_timeseries, health_economics, investor_summary, operations_summary, population_summary, programme_funnel, provider_capacity, referral_turnaround, reputation_review_conversion, retention_cohorts, revenue_by_product, revenue_timeseries, safety_dashboard_summary, screening_referral_funnel, specialist_provider_performance, specialist_provider_workload, staff_activity, support_response_time, support_ticket_summary, traffic_summary, traffic_timeseries, user_segments | Re-created from the live body with relations redirected to the filtered views |
| Config, snapshot or gate only, 4 | business_summary (reads `analytics.rpc_snapshots`, refreshed nightly by `private.refresh_analytics_snapshot_business_summary`, which is fixed and re-run in the migration), finance_inputs, risk_register, population_dataset_preview (delegates to `get_geo_health_aggregates`, which is fixed) | No body change needed |
| Record lookups and writers, 6, EXEMPT | patient_search, patient_activity, audit_log, log_patient_access, upsert_finance_input, upsert_risk | Unchanged on purpose: support and audit must be able to find a test account's own rows (INV-12 note, OQ in S39). They return rows, not metrics. |

Callers: every function but three is called from `apps/web/src/lib/analytics/queries.ts` (or `provider-performance.ts`, `specialist-provider-network.ts`, `broadcasts.ts`, the analytics dashboards). `analytics_clinical_rule_performance`, `analytics_health_economics` and `analytics_population_dataset_preview` have no caller in `apps/`, `packages/`, `supabase/functions`, any cron job, view, policy or function body (checked live).

## Decision
Preferred order was (a) retire dead ones, (b) filter live ones with the shared predicate, (c) one central fix.

* (a) Not done. Three functions are dead today, but filtering them costs nothing under (c), whereas dropping a function an unmerged branch may call is the riskier act. Retiring them is left as a separate founder decision.
* (c) Chosen. Editing 46 bodies by hand is error prone. Instead a new schema `analytics_clean` holds one `security_invoker` view per patient-bearing relation the RPCs read (55 views). Each view is the relation minus test accounts, using exactly the S02 convention: `NOT EXISTS (select 1 from public.profiles tp where tp.id = t.<patient column> and tp.is_test)`, so a NULL patient or actor (an anonymous page view, a system audit row) is kept. The RPC bodies are the live bodies with `public.<t>` or `private.<t>` replaced by `analytics_clean.<t>`: a pure text substitution, no query logic touched.
  * Special cases: `profiles`, `clinical_staff`, `facilities`, `pharmacy_orders` carry their own `is_test` and use it (staff also via their profile); `complaints` and `support_tickets` test both the patient and the creator; `commissions` and `payment_transactions` have no patient column, so the view tests the patient of the source row (service purchase, lab order, pharmacy order, referral); `real_patient_ids` is the old email heuristic minus `is_test`.
  * Not filtered because they hold no person: leads, organisations, catalogues, risk register, finance inputs, consent and protocol versions, rule definitions.
* (b) The predicate is `profiles.is_test` itself. No second helper was invented. `private.real_patient_ids()` is left alone (it also drives notification features) and wrapped by `analytics_clean.real_patient_ids`.

Preserved exactly: signature, return type, volatility, `SECURITY DEFINER`, `search_path = ''`, grants (restated: `revoke all ... from public, anon; grant execute ... to authenticated, service_role`). Nothing is exposed: `analytics_clean` has no USAGE for anon or authenticated and the views are revoked; the migration ends in assertions for this and for "no body still reads an unfiltered relation".

Traps checked: every division in the 46 bodies is already guarded (`nullif`, `case when ... = 0`, `greatest(count(*), 1)`), and every function returns an aggregate or a jsonb array, so an emptier input set changes counts, never the shape or raises. Two feeders outside the 56 were fixed so the numbers agree: `private.refresh_analytics_snapshot_business_summary()` (and the stored snapshot is refreshed in the migration) and `public.get_geo_health_aggregates()`.

## Risk
* Column drift: a view freezes its column list. A column added later to one of these tables is invisible to the RPCs until the view is re-created; dropping a selected column fails loudly. Accepted, and the scan test names the views.
* Behaviour change: dashboards drop to zero test rows (intended). Any E2E that reads an analytics number from a test account will no longer see itself.
* Performance: each view adds an anti-join on `profiles` (primary key). Fine at current volumes; revisit with SR plan sizes.
* Not covered: `leads` (no account), exempt lookups above, and any direct table read outside these RPCs (the `*_quality_metrics` views, OQ-39 part 2, are separate and unchanged).

## Regression guard
`packages/db/tests/oq39_analytics_exclude_test_data.sql` (registered in `ci.manifest`): a catalogue scan fails if any non-exempt `analytics_*` function (or the two feeders) reads a filtered relation directly, or reads any other relation that has a person column (`patient_id`, `profile_id`, `recipient_id`, `actor_id`, `is_test`) without a view; a behavioural run seeds a test and a real patient across the tables and proves the test patient changes no function's output; sabotage steps prove both halves can fail.
