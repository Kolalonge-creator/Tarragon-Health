# Closeout: pulse, SpO2 and temperature rule set (vitals_care_triage v1)

Branch `build/vitals-rule-sets`. Nothing applied, deployed, signed, merged or switched on.

## Built
Engine twin and rule set (15 rules, draft), handler and ports, four migrations, PROPOSED config key with a four-way drift test, band-scan extension, wording (unsigned), CMO hub line and panel, task-type line and panel, nav and search entries, divergence report, parity-report fix, page dedupe key, three DB proofs with sabotage, docs.

## Tests
- packages/clinical: 883 tests, 100 percent branch, statement, function and line coverage held (new: `vitals-engine.test.ts` 28 including an oracle comparison with the older classifiers over every whole bpm 10 to 300, SpO2 50 to 100 and every tenth of a degree 25 to 45; `vitals-handler.test.ts`; `vitals-drift.test.ts` 25).
- packages/i18n 226, packages/shared proposed-config 313, apps/web hub, panel, actions, query and basis tests green; tsc clean for apps/web.
- DB proofs written and registered in `ci.manifest`: `build_vitals_triage_wiring.sql`, `build_vitals_shadow_divergence.sql`, `build_red_page_dedupe_key.sql` (final select prints `PASS`, and `PASS (caught)` for each sabotage row).

## Not proven (read this)
See the section "DB proofs" at the end of this file for what was and was not run against the live project.

## Open questions (proposed OQ text)
1. Confirm the starting bands against NEWS2 (pulse 35/150 vs NEWS2 40/131; SpO2 emergency under 90 vs 91; temperature 39.0 vs 39.1) or move them.
2. Under-18 heart rate routed to a clinician instead of paged (VT-PU3): confirm the age line and the behaviour.
3. Known COPD patients (target 88 to 92) would be paged at 92; decide a handling before wide use.
4. Wearable and monitor readings are not graded by the engine in v1; decide a freshness window and a resting-only rule if wanted.
5. Typo gate: a reading outside the possible range is rejected (the older trigger would page it). Consider a repeat-reading flow.
6. Amber review due time 72 hours and class 5 are PROPOSED; task type `amber_vitals_review` needs confirmation.
7. Patient-facing display of vitals grades does not exist; the wording is unsigned and not in the catalogue.
8. Follow-up: `TriageRulesPanel` lists ANY unconfirmed task type as blocking a signature while the database (OQ-334) counts only those this rule set can create; with the glucose task type unconfirmed the vitals Sign form is hidden although the database would allow it. Fix the panel to match.

## Follow-ups
Retire the three older triggers by count-first migration once the divergence report shows parity; on-device vitals grade; `vitals_care_triage` v2 with symptoms or a repeat-reading flow if the CMO wants.

## Order to apply and deploy
1. Merge into `main-dev` after CI is green. Merge auto-applies migrations, so deploy first.
2. Deploy `process-events` from this branch BEFORE the migrations land (its vitals branch is inert until a vitals event exists, but an old handler would consume a `kind: vitals` event as blood pressure and drop it, losing that shadow evidence).
3. Migrations in file order: `20261016191543_build_vitals_care_triage_v1_draft.sql`, `20261016191800_build_vitals_triage_wiring.sql`, `20261016191830_build_vitals_shadow_divergence.sql`, `20261016191936_build_red_page_dedupe_key.sql`. Re-check `list_migrations` for anything new first.
4. Web deploy (hub page, panels).
5. CMO: confirm task type `amber_vitals_review`, read the hub panel, sign the rules and, separately, the wording. Run `triage_vitals_shadow_divergence` over a window of real readings first.
6. To make a signed rule set page once per reading: also sign the unified red-event paging config (S19d) after its test pack; until then both the older broadcast and the engine page reach clinicians.

## DB proofs
The live project's connection pool was exhausted for the whole session (every `execute_sql` and `supabase db query --linked` call ended in "Connection terminated due to connection timeout" or a gateway 524 after about 100 seconds), so the three proof scripts and the four migrations were NOT executed against Postgres with the real schema. What was done: all seven SQL files were run through a local Postgres 16 and produced no syntax error (only "relation or schema does not exist", expected without the Supabase schema); the live definitions the patches depend on were read earlier in the session (classify_* bodies, create_red_page md5 227cf60f..., triage_rule_set_for_grading). To finish: from the main checkout, splice each proof after a migration set and run it in one transaction, for example `scripts` pattern of the glucose branch: `begin; <migrations>; <proof body>; rollback;` with `npx supabase db query --linked -f`. The proofs are written to end in `PASS` / `PASS (caught)`; CI's replay job will also run them from `ci.manifest`. Until one of these has been seen green, treat the SQL as unproven. The `create_red_page` patch fails loudly (asserted anchors, expected exactly once) rather than silently doing nothing.
