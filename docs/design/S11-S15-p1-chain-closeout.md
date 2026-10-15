# P1 closeout: chain canary, chain health, measurement, parity

Branch `s11-s15/p1-chain-canary`. Nothing applied, deployed, merged, signed or switched on.

## Built
- `supabase/migrations/20261013223401_p1_chain_canary.sql`: config (`chain_canary_config`, validated), fixtures (`chain_canary_fixtures`: red BP, amber BP, disabled glucose hook for P2), synthetic subjects, record-only notification trigger, deferred auto-acknowledge trigger on `pages`, append-only `chain_canary_runs`, start/evaluate/tick, `public.chain_canary_run_now()`, cron `chain-canary` at minutes 11 and 41.
- `supabase/migrations/20261013223824_p1_chain_health_measures_parity.sql`: `public.chain_health()`, `public.chain_reliability_report(days)`, `public.triage_engine_parity()` and `_cases()`, `analytics.v_chain_timings`, `private.chain_timing_rows/chain_stats`.
- Web: `/admin/ops/chain-health` and `/clinician/chain-health` (shared `ChainHealthPanel`), run-now action, nav and search entries, `lib/chain-health/model.ts`.
- Registry key `chain.canary_and_health` v1 (PROPOSED, CMO) with a drift test; types spliced into `packages/shared/src/database.types.ts` (functions only).
- R0: `whatsapp-webhook` and `send-support-reply` have NO source in the repo (removed in S01c); nothing in the repo, in any database function body or in any cron command calls them (checked live). Only a stale comment in `.github/workflows/ci.yml` was corrected. **Founder/lead step: delete the two deployed functions** (`supabase functions delete whatsapp-webhook`, `... send-support-reply`); an agent must not delete live functions.

## Reused
Event bus, `record_triage_result`, `create_tasks_from_triage_event`, `create_red_page`, `acknowledge_page`, `private.apply_task_transition`, `ops_alert_incident`, `notification_text_violations`, `log_audit`, S38 `analytics` schema and `outcome_rule('min_cell')`, `stale_cron` ops rule, existing admin ops pages pattern.

## Tests
- DB proofs (registered in `ci.manifest`): `p1_chain_canary.sql` (about 55 checks, sabotages: stopped processor, auto-ack trigger dropped, record-only trigger dropped), `p1_chain_health.sql` (about 40 checks, sabotage: analytics view pointed at test rows). Each run live inside `begin ... rollback` through the Supabase CLI, three times for the canary: pass. Live state checked afterwards: no table, org, profile, job, incident or notification left behind.
- Existing proofs re-run with the migrations spliced in: s12b, s19, s16 pass. `s12_triage_wiring` fails on live for a reason unrelated to P1 (it expects the rule set to be a draft; v3 is approved live).
- Jest: `chain-canary-mirror.test.ts` (2), proposed-config suite 131 total pass; web `chain-health` model (7) and actions (4); admin-search and navigation suites pass. `tsc` and ESLint clean for `packages/shared` and `apps/web`.

## Could not be proven
The real edge function `process-events` and the real cron were not run (no deploy, no apply): the proofs stand in for the processor by calling the same RPCs its handlers call. The first true end to end run happens on the first cron tick after apply. Sending of notices (push, email) is not exercised by design (suppressed for the synthetic profiles); the page watches real critical notices instead. No real phone.

## Apply order
1. `20261013223401_p1_chain_canary.sql`, then 2. `20261013223824_p1_chain_health_measures_parity.sql`. Both use real timestamps; live `list_migrations` showed only `20261013220108 sign_poc_panels` that is not in this branch (unrelated, pinned live). No edge function needs deploying for P1. Merge triggers the auto-apply workflow (files carry no own begin/commit).
3. After apply: the first tick (minute 11 or 41) creates the synthetic organisation, patient, clinician and admin and starts run 1; the second tick judges it. Open `/admin/ops/chain-health` to see the first result. If it fails at `graded`, the deployed `process-events` or its secret is the first suspect, which is exactly the finding the canary exists to give.

## Open questions (proposed OQ text)
1. CMO: confirm the canary budgets and health thresholds in `chain.canary_and_health` (publish v2 to change; nothing needs a hub signature).
2. Founder: the canary adds a synthetic organisation (`metadata.canary`) and three synthetic profiles to production. Acceptable? Reason: the live legacy BP and symptom triggers notify every clinician in the patient's organisation and ignore `is_test`; a fixture anywhere else would page real doctors.
3. Founder: add an external heartbeat (an outside monitor that alerts when `chain_canary_runs` stops moving)? Today the only independent watcher is the in-database `stale_cron` rule.
4. D1: retire nothing until the parity table on the chain health page has run over real readings; the legacy trigger also pages every clinician in the organisation, which the engine's on-call paging does not, so parity of the two is a behavioural difference to decide, not only a grade difference.
5. Retention: `triage_events` is append-only, so canary events (about 96 a day) cannot be pruned; hand to the SR3 retention work (other canary tables are pruned at 30 days or are bounded).

## Follow-ups
- P2: enable `glucose_red_severe_hypo` in `chain_canary_fixtures` once the glucose rule set grades through the bus (the start function already inserts glucose readings; the proof's processor stand-in covers BP only).
- P3/P4 (credentialing): if a trigger later requires a stored MDCN/DataFlow verification before a clinician is active, exempt `is_test` staff or the canary clinician cannot be recreated.
- Hazard log entry for DCB0129-style monitoring is the CMO's document (`docs/CLINICAL_FEATURE_CHECKLIST.md`).
- Phone-side proof (offline red under one second) is untouched by P1.
