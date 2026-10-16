# Closeout: personal threshold overrides (branch build/patient-threshold-overrides)

## Built
- Pure engine layer `supabase/functions/_shared/clinical/threshold-override.ts` (re-exported by `packages/clinical`): `applyBpOverride`, `applyGlucoseOverride`, `validateOverrideParams`, `OVERRIDE_LIMITS`. `AppliedOverride` provenance on `TriageResult`.
- Handler wiring (`observation-handler.ts`, `process-events/triage-ports.ts`): optional ports, safe fallback on a failed load.
- Migration `supabase/migrations/20261016191203_n_patient_threshold_overrides.sql` (one file, no begin/commit): policy, overrides, events, provenance, clamps, RPCs, task type, cron `threshold-override-review-daily` at 06:12 UTC, self-check.
- Web: chart card + actions, CMO roster page + actions, hub line + inline panel + attention line, nav and console search entries, patient note, queries.
- Docs: `docs/research/build-threshold-overrides.md`, `docs/design/build-threshold-overrides.md`.

## Tests
- `packages/clinical`: 861 tests passing, 100 percent statements, branches, functions, lines (global threshold met) including `threshold-override.test.ts` (36, with a grid sweep proving no red is lowered and no symptom or pregnant case is relaxed, across rule sets v1, v3 to v6) and `threshold-override-handler.test.ts` (9).
- `packages/shared`: `threshold-override-mirror.test.ts` (policy seed equals registry entry; engine clamps equal database clamps; task type).
- `apps/web`: proposal parser (4), queries (3), chart actions (7), CMO actions (5), hub (3 added); tsc and ESLint clean.
- DB proof `packages/db/tests/patient_threshold_overrides.sql`, registered in `ci.manifest`: 51 real checks and 4 sabotage rows (tie and authority removed; clamp function accepts anything; loader ignores expiry; provenance CHECK dropped) all reading `PASS (caught)`. 

## Unproven (be explicit)
- The production database connection timed out for the whole build session, so the migration and proof were run ONLY against a local PostgreSQL 16 with stubbed versions of the surrounding tables and helper functions (profiles, clinical_staff, care_team_assignment, staff_may_read/write, has_prescribing_authority, vitals_readings, triage_events, task_types, create_clinical_task). They have NOT been run against the real schema or `supabase db reset`. The `Supabase migration replay` CI job is the first real run; expect to fix fixture details (for example `care_team_assignment` columns, `patient_pregnancy` columns, task-layer config for the review task) if it differs. Nothing was applied to production.
- The checked-in `database.types.ts` was not regenerated; new RPCs and tables are called through narrow typed casts (CLAUDE.md: splice, never wholesale regenerate). A follow-up should splice the types.
- No real doctor session, phone or deployed edge function was exercised. The edge handler path is proven with fakes.
- The `list_migrations` check for unknown recent live migrations could not be done (DB unreachable). The lead should run it before applying.

## Apply and deploy order
1. Merge (the merge auto-applies the migration). Either order with the code is safe: the handler treats a failed override load as "no override"; the web hub names the source as unreadable until the migration lands.
2. Deploy the `process-events` edge function (the only function that changed).
3. Vercel deploys the web app from `main-dev`.
4. The feature stays dormant until the Chief Medical Officer signs the policy on `/clinician/clinical-signoff` (hub line "Personal alert thresholds"). Agents never sign.

## Open questions (proposed text for OQ)
- OQ-N1: Are the PROPOSED limits right (BP target 100/60 to 160/100, low-reading line 80 to 90, glucose treat-now line 3.9 to 5.0, red line 3.0 to 3.5, maximum 90 days, monthly review)? CMO to confirm or change by a code change.
- OQ-N2: Should a patient be told by an in-app notification when a personal target is set or ends (neutral wording, no number)? Currently only a note on the vitals page.
- OQ-N3: Should the BP and glucose divergence reports exclude overridden events by default (a join on `triage_override_applications`)? Not rewritten here.
- OQ-N4: Should the monthly review be done by the signing doctor rather than the pool? Today any senior doctor may take the routine review task and the CMO can always review.

## Follow-ups
Splice the new tables and RPCs into `packages/shared/src/database.types.ts`; add the override join to the divergence functions once their live definitions are read; consider a relax path for BP-A4/A5 only if the CMO asks.
