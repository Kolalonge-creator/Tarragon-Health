# S11 to S15 package P2 (glucose): closeout

Branch `s11-s15/p2-glucose-engine`. Nothing applied, deployed, signed, merged or switched on.

## Built
- `glucose_care_triage` v1 (15 rules, DRAFT) and its engine twin `supabase/functions/_shared/clinical/glucose-engine.ts` (same evaluator, actions, result, summary, fixtures format, winner semantics, INV-05 check); re-exported from `packages/clinical`.
- Server wiring in shadow: glucose reading -> `observation.recorded` (kind glucose) -> `triage.grade_observation` -> `triage_events`; context and writer functions; symptom regrade; 10-minute sweep. BP path untouched.
- Phone: `gradeGlucoseOnDevice`, `evaluateGlucoseOnDevice` (stricter of old check and engine), sign chips, ketone entry, TRI/EMG-style card, rule set refresh. Ketones typed with a glucose are stored as their own ketone reading (inserted first), so the older DKA pager sees them too.
- Q4: upper-arm advice beside a repeat prompt for wrist or "not sure" cuffs (phone only), never touching the grade.
- Parity tooling: glucose shadow divergence report; fix of the BP divergence report so glucose results cannot corrupt it.
- CMO hub: line, page `/clinician/glucose-triage-rules`, inline panel with numbers, per-rule guideline basis and citations, open points, full patient wording (shown today beside proposed), and the Sign control. Nav and search entries.
- Scan test: no glucose or BP band outside a rule set (14 allowlisted legacy files, exact counts).
- Docs: research, design, this file.

## Reused
Condition evaluator, `triage_rule_sets`, `triage_events`, event bus, `create_tasks_from_triage_event`, `create_red_page`, two-tier Free handling (no clinic task or page for a Free patient; the in-app guidance record instead), `approve_triage_rule_set`, the S16b task type confirmation, the existing `TriageRulesPanel` and `approveRuleSetAction` (parameterised by rule set code and return page).

## Tests
- packages/clinical: 562 in the package: 100 percent branch, statement, function and line coverage held. New: glucose engine and fixtures (51 cases), handler and ports, drift and wording, validator parity, band scan.
- packages/i18n: 94 (13 new for glucose wording).
- apps/mobile: 1893 in the package (80 of them new): device/server parity on 50 of the 51 shared fixtures (the one with an already-open task is a server fact) through the phone path, offline severe low under 1 second (also with a hanging store and a thrown network), stricter-of, cuff advice (4 cuff types, red never downgraded), rule set cache and facts.
- apps/web: whole suite green (584 suites, 5194 tests). New: hub reader and hub line, basis map and the build-match guard, panel wiring, action return page, route ketone persistence as its own reading.
- DB proofs against the live project inside begin/rollback with a 15-element stand-in for the rule JSON (the exact JSON is pinned by the Jest drift test): `r2_glucose_triage_wiring.sql` 61 checks, `r2_glucose_shadow_divergence.sql` 16 checks, each with sabotage steps that flip a check; both registered in `ci.manifest`. Residue checked afterwards: none (no rule set, trigger, cron job or profile left; `private.patient_may_page_doctor` intact).
- tsc and ESLint clean for clinical, i18n, mobile and web (only existing warnings elsewhere).

## Code review (high), two passes: findings fixed
Absent age or diabetes type (jsonb_strip_nulls) made every reading of such a patient invalid; an out-of-range ketone vetoed grading; the 1.1 mmol/L floor rejected the lowest values both forms accept; pregnancy, under-18 and other-type routing lost to the adult ambers for a level 1 low (GL-A1P added); no glucose symptom regrade; the glucose rule refresh was never called and shared the BP stale-warning timer; the sweep aborted on one bad row; ketones typed on the phone were dropped; a nearly duplicated validator (now pinned by a parity test). Second pass: ketones on the glucose row were invisible to the older DKA pager (now a separate reading); a ketone arriving after the glucose did not regrade it (trigger added); streaming CGM and wearable rows would flood the bus and could page stale lows (the producer, the context lookups and the sweep now take manual and Bluetooth meter readings only); retracted (entered in error) readings and ketones were still used (filtered); 70 mg/dL converted to 3.88 and read as a low (compared at one decimal, with an every-whole-mg/dL boundary test); a ticked sign with no valid number showed no guidance on the phone (now shown); the hub panel could show version 1's basis beside a different version's Sign button (hidden unless the draft equals this build's text). Not fixed, raised as questions below: the nine signs not stored on the server; a rejected reading with a sign stores nothing on the server.

## Open questions (proposed OQ text)
1. **Signs not stored on the server.** The nine signs ticked on the phone grade there but only four map onto the server's symptom log. Server paging for GL-R2, GL-R3, GL-R5 (vomiting, stomach pain) and GL-R7 from phone entries is therefore incomplete. Proposed: add the five missing symptom types in a separate enum migration and send the ticked signs with the glucose through the offline outbox as symptom rows (as blood pressure does). Decide whether to sign before that.
2. **Monitor and wearable glucose is not graded by this engine in v1** (manual and Bluetooth meter only), to protect the connection budget and avoid paging stale lows from bulk syncs; the older alerts alone cover those sources. Proposed: a later version grades them with a freshness window and a dedupe interval taken from config, if the CMO wants it.
3. **Both pipelines page.** After signing, a severe low or suspected DKA is paged by the engine and by the older backstop until parity is shown. Proposed: the divergence report runs for a stated period, then a count-first retirement migration of the SQL backstop and the two `glucose-red-flags` files (the scan test allowlist then shrinks).
4. **Unknown diabetes type** is graded as an adult (a prevention user checking a reading is not routed every time). Confirm.
5. **Ketone readings the decisions did not state**: urine moderate or large counts as raised ketones; ketones of 3.0 or more with warning signs are red even under glucose 11.0; nothing between 11.0 and 20.0 without ketones. Confirm or strike.
6. **Due time** of the urgent review (480 minutes) is PROPOSED. **Level 1 low opens no task** (recurrent level 1 was not chosen).
7. **Nigerian guideline.** Only the August 2020 draft of the FMoH diabetes guideline could be opened. It uses 4 mmol/L as its low line and 13.3 mmol/L with urine ketones as its DKA warning line; the rules use the ADA 3.9 and the CMO's 11.0. Check the final 2021 text before signing, and the wording of the treatment message.
8. **Fast-sugar wording** uses the draft's local examples (sweet drink, sugar, honey) and 15 g with a 15 minute recheck (the draft says 10 to 15). Needs the CMO's signature as wording, separately from the rules.
9. **Older glucose alerts compare the unrounded value**, so they call 70 mg/dL (3.88 mmol/L) a low; the new rules do not. Expect that as a divergence (live urgent only for 3.0 to 3.8) once the divergence report covers the urgent tier; it is a bug of the older pipeline, not of the new rules.
9b. **BP latent issue found, not changed:** `validateInput` for blood pressure compares `ageYears !== null` against a value `jsonb_strip_nulls` can drop, so a patient with no date of birth may be rejected as invalid input on the BP path too. Registration now needs a date of birth (S04b), so this may be unreachable; worth a one-line check.
10. **Third BP band list:** `apps/web/src/lib/cds/engine.ts` carries its own BP bands (200/120, 160/100, 135/85). Allowlisted with a reason; move it onto the rule set.
11. A new unconfirmed task type blocks `approve_triage_rule_set` for ANY rule set (including `bp_care_triage` v4) until the CMO confirms `amber_glucose_review` on the task types page.

## Follow-ups
Glucose audio clips once wording is signed; a diabetes competency so glucose reviews route to a diabetes-trained doctor; `amber_glucose_review_due_soon` promotion class (BP has one); pulse, SpO2, temperature rule sets on the same pattern; persist the glucose context in `/api/mobile/vitals` (the route stores the value but not `glucose_context`, so the server context defaults to random; no v1 rule reads it); SGLT2 rule only if the CMO asks.

## Not done, and why
No migration applied, no function deployed, no rule set, wording or task type signed or confirmed. Not run on a real phone or Hermes (Jest-Expo and Node only). The deployed edge function, the real event bus delivery, and the auto-apply workflow were not exercised: the DB proofs call the functions directly, the handler is tested with fakes over the same JSON the functions return. Accessibility of the new glucose chips (screen reader labels) was not run on a device. The exact rule JSON was not applied to the live project (a stand-in of the same size was); the Jest drift test pins file against SQL.

## Order to apply and deploy
1. Merge the PR into `main-dev` after CI is green. NOTE: merge auto-applies migrations, so do step 2 FIRST.
2. Deploy `process-events` from this branch BEFORE the migrations land (its glucose branch is inert until a glucose event exists, but an old handler would consume a glucose event as "not blood pressure" and drop it, losing that shadow evidence).
3. Migrations in file order: `20261013223643_r2_glucose_care_triage_v1_draft.sql`, `20261013223731_r2_glucose_triage_wiring.sql`, `20261013225326_r2_glucose_shadow_divergence.sql`. (Re-check `list_migrations` for anything new from other sessions first; the timestamps are real UTC times from 2026-10-13 22:36 to 22:53.)
4. Web deploy (hub page, route ketones) and an OTA of the mobile JS (JS only, no native change, `runtimeVersion` unchanged).
5. CMO: confirm task type `amber_glucose_review`, read the hub panel, sign the rules and, separately, the wording. Run the glucose divergence report (`triage_glucose_shadow_divergence`) over a window of real readings first.
