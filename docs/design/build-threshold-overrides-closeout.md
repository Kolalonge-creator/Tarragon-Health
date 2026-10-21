# Closeout: personal threshold overrides (branch build/patient-threshold-overrides)

## Built
- Pure engine layer `supabase/functions/_shared/clinical/threshold-override.ts` (re-exported by `packages/clinical`): `applyBpOverride`, `applyGlucoseOverride`, `validateOverrideParams`, `OVERRIDE_LIMITS`. `AppliedOverride` provenance on `TriageResult`.
- Handler wiring (`observation-handler.ts`, `process-events/triage-ports.ts`): optional ports, safe fallback on a failed load.
- Migration `supabase/migrations/20261016191203_n_patient_threshold_overrides.sql` (one file, no begin/commit): policy, overrides, events, provenance, clamps, RPCs, task type, cron `threshold-override-review-daily` at 06:12 UTC, self-check.
- Web: chart card + actions, CMO roster page + actions, hub line + inline panel + attention line, nav and console search entries, patient note, queries.
- Docs: `docs/research/build-threshold-overrides.md`, `docs/design/build-threshold-overrides.md`.

## Tests
- `packages/clinical`: 864 tests passing, 100 percent statements, branches, functions, lines (global threshold met) including `threshold-override.test.ts` (37, with a grid sweep and a drift pin: an override that restates the signed defaults changes nothing across every rule set and case proving no red is lowered and no symptom or pregnant case is relaxed, across rule sets v1, v3 to v6) and `threshold-override-handler.test.ts` (12).
- `packages/shared`: `threshold-override-mirror.test.ts` (policy seed equals registry entry; task type). `packages/clinical`: `threshold-override-mirror.test.ts` (engine clamps equal database clamps).
- `apps/web`: proposal parser (4), queries (3), chart actions (7), CMO actions (5), hub (3 added); tsc and ESLint clean.
- DB proof `packages/db/tests/patient_threshold_overrides.sql`, registered in `ci.manifest`: 54 real checks and 4 sabotage rows (tie and authority removed; clamp function accepts anything; loader ignores expiry; provenance CHECK dropped) all reading `PASS (caught)`. 

## Unproven (be explicit)
- The production database connection timed out for the whole build session, so the migration and proof were run ONLY against a local PostgreSQL 16 with stubbed versions of the surrounding tables and helper functions (profiles, clinical_staff, care_team_assignment, staff_may_read/write, has_prescribing_authority, vitals_readings, triage_events, task_types, create_clinical_task). They have NOT been run against the real schema or `supabase db reset`. The `Supabase migration replay` CI job is the first real run; expect to fix fixture details (for example `care_team_assignment` columns, `patient_pregnancy` columns, task-layer config for the review task) if it differs. Nothing was applied to production.
- The checked-in `database.types.ts` was not regenerated; new RPCs and tables are called through narrow typed casts (CLAUDE.md: splice, never wholesale regenerate). A follow-up should splice the types.
- No real doctor session, phone or deployed edge function was exercised. The edge handler path is proven with fakes.
- The `list_migrations` check for unknown recent live migrations could not be done (DB unreachable). The lead should run it before applying.

## Apply and deploy order
1. Merge (the merge auto-applies the migration). Apply the migration BEFORE deploying the edge function. If the function is deployed first it still grades (an absent database function is read as "no override" quietly), and the web hub names the source as unreadable until the migration lands.
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

## Code review (high, with the RLS and authority class named) and what changed
Confirmed and fixed: the patient had a direct table read that exposed numbers and the reason (removed; notice RPC only); the policy withdraw was one-way (a withdrawn version can be signed again); a failed override load was swallowed (now retried through the bus, then a loud log); an exception inside the override layer could stop grading (guarded); the CMO path skipped the tie for keeping an override and the roster audited only a count (keeping needs the tie, ending does not; one audit row per override read); a propose-and-sign with only a logged opening (now a true tie); the sweep's failures were invisible (counted on the CMO page, cancellations re-raised); the card showed an expired override as live (now flagged); the extra lookup now runs beside the rule-set read.
Accepted: the engine restates the BP-A2/A7 conditions instead of reading the rule's condition tree, pinned by the identity drift test. The extra service-role RPC per reading remains (an indexed lookup); folding it into the context functions is a follow-up when they are next rewritten from their live definitions.
