# S11 to S15 package P2: glucose triage engine (plan item R2) and the Q4 cuff advice

Status: built on branch `s11-s15/p2-glucose-engine`, NOTHING applied, deployed or signed. Decisions implemented: CMO Q4, Q6, Q7, Q8, Q9 (docs/DECISIONS.md, "CMO decision pack S11 to S15, 2026-10-07"). Research: docs/research/S11-S15-glucose.md. Closeout: docs/design/S11-S15-glucose-closeout.md.

## 1. What is reused, what is new

Reused unchanged: the declarative condition language and evaluator (`conditions.ts`), the action vocabulary, the result and summary types (so the same fixture format and the same device/server parity test), `triage_rule_sets`, `triage_events`, the event bus subscriber `triage.grade_observation`, `triage.graded`, `create_tasks_from_triage_event`, `create_red_page`, the two-tier Free handling (`patient_may_page_doctor`, `record_free_red_event`, `open_free_notice`), the CMO sign-off hub, `approve_triage_rule_set`.

New: `glucose-engine.ts` (own input, context and parameter types, own input validation and rule-set validation, the same winner semantics); the rule set `glucose_care_triage` v1; producer, context and writer functions for glucose; a glucose divergence report; the glucose sign-off panel; the phone path.

Why a second engine file and not a change to `grade()`: `grade()` and `validateInput` are BP-shaped (systolic, diastolic, a personal target, recheck state, pathway) and 100 percent covered. Widening them to glucose would have touched a live, approved safety path to add a feature. The glucose twin shares the evaluator, `conditionErrors`, `actionErrors` (exported, no behaviour change), `flattenParams`, the result shape and the summary, so a rule reads and behaves the same. `grade()` is byte-for-byte unchanged apart from the `Rule.triggers` type now also allowing `"glucose"`.

## 2. The rule set (all numbers PROPOSED, DRAFT, unsigned)

Input: glucose in mmol/L (a phone holding mg/dL converts first with `mgDlToMmolL`), context (fasting, pre_meal, post_meal, bedtime, night, random; carried, no rule uses it in v1), blood ketones mmol/L or urine band, nine signs, age, pregnancy, diabetes type. SGLT2: not added (the CMO did not choose that rule).

| Rule | Condition | Grade and action | Decision |
|---|---|---|---|
| GL-R1 | glucose under 3.0 | red, guidance GLU-E01, page | Q6, everyone |
| GL-R2 | glucose under 3.9 with confusion, seizure, unconscious, cannot swallow | red GLU-E01, page | Q6 level 3 |
| GL-R3 | those signs at any glucose | red GLU-E02, page | Q6 level 3 |
| GL-R4 | glucose 11.0 or more and (blood ketones 3.0 or more, or urine moderate/large) | red GLU-E02, page | Q7, everyone |
| GL-R5 | ketones raised (1.5 or more, or urine moderate/large) with vomiting, stomach pain, fast breathing, drowsiness | red GLU-E02, page | Q7 |
| GL-R6 | glucose 33.3 or more | red GLU-E02, page | Q8 |
| GL-R7 | glucose 20.0 or more with vomiting, drowsiness, confusion, very thirsty and cannot keep fluids | red GLU-E02, page | Q8 |
| GL-A1P | 3.0 to under 3.9 AND (pregnant, under 18, gestational or other type) | amber, GLU-T01 AND route_referral plus weekly `referral_review` | Q6 level 1 with Q9 |
| GL-A1 | 3.0 to under 3.9 | amber, message GLU-T01 (treat now, recheck in 15 minutes), no task | Q6 level 1 |
| GL-A2 | ketones raised, no warning signs | amber, GLU-T02, task `urgent_glucose_review` due 480 min (PROPOSED) | Q7 |
| GL-A3 | glucose 20.0 or more | amber, GLU-T03, same task | Q8 |
| GL-P1/P2/P3 | pregnant / under 18 / gestational or other type | amber, GLU-T04, route_referral and weekly `referral_review` (1440 min) | Q9 |
| GL-G1 | glucose 3.9 or more, nothing above | green, GLU-T05 | |

Rules run in file order; first red wins, otherwise the first amber, otherwise green. So the reds apply to everyone first; then the level 1 low (GL-A1P before GL-A1, so a pregnant, young or non-type-1-or-2 patient gets the treat-now message and the routing); then the urgent ambers, where the urgent same-day review is itself the route to a clinician and is stricter than the weekly referral review; then routing; then green.

Judgement calls the CMO is shown on the hub, not hidden: (a) no diabetes type recorded is graded as an adult (otherwise every prevention user would be routed); (b) urine moderate or large counts as raised ketones; (c) ketones of 3.0 or more with warning signs are red even under glucose 11.0; (d) nothing between 11.0 and 20.0 without ketones; (e) the 480 minute due time; (f) a level 1 low opens no task because recurrent level 1 (option c) was not chosen.

## 3. Data and events

- `observation.recorded` gains `payload.kind = 'glucose'` for a glucose reading (ids only, idempotency key `glu:<id>`), from the new trigger `vitals_readings_emit_glucose_observation`. The BP trigger and function are untouched. `process-events` routes on `kind`; the BP path is the default.
- `public.triage_context_for_glucose_observation(id)`: ketones on the reading, else a ketone reading within 30 minutes; symptoms logged within 10 minutes mapped (confusion, breathlessness to fast_breathing, lethargy to drowsiness, dehydration_signs to very_thirsty_cannot_keep_fluids); `patient_diabetes_profile` (confirmed type first); `patient_pregnancy`; age.
- `public.record_glucose_triage_result(...)`: the graded half of `record_triage_result`, with no recheck handling. Reason: `record_triage_result` resolves the patient's pending BP recheck and closes the repeat-reading task; using it for glucose would silently do that (proved, sabotage step 2).
- Shadow: while the rule set is a draft the result is `shadow = true` and the task and paging subscribers ignore it, in the handler and in `create_tasks_from_triage_event` / `create_red_page`.
- A symptom that reaches the server just after a glucose reading (confusion, breathlessness, lethargy, dehydration signs) re-emits that reading (`symptoms_emit_glucose_regrade`, as blood pressure has); the symptoms are part of the basis, so the regrade is a new result.
- A sweep (`triage-glucose-sweep`, minute 7 of every 10 minutes) re-emits a glucose reading with no event in the last 24 hours; one reading that cannot be emitted is logged and skipped and does not stop the others. Not per minute: the production connection budget is tight.
- Input validation, from the code review: only the GLUCOSE can make a reading implausible (0.5 to 55.5 mmol/L, wider than both entry forms, so every value anyone can enter is graded and a severe low is never rejected); a blood ketone outside the meter range (0 to 20, as the server accepts) is clamped, never a reason to skip grading; an absent age or diabetes type (the server context drops nulls) means not recorded, not invalid.
- Ketones typed on the phone with a glucose are stored on the same reading (`/api/mobile/vitals`, `ketones_mmol_l`, `ketone_urine`), so the server's shadow grade sees them. The signs are not stored (see the closeout).
- Task type `amber_glucose_review` (source key `urgent_glucose_review`), created with `needs_confirmation = true` so the CMO confirms it before the rule set can be signed. Competency `adult_general` because no diabetes competency exists.
- `private.triage_divergence_rows` (the BP divergence report) gains `rule_set_code = 'bp_care_triage'`: without it every glucose shadow result would have been counted in the BP evidence as a shadow-only red or a neither-urgent. New `triage_glucose_shadow_divergence` and `_disagreements` compare against the older pipeline's emergency events.

## 4. Phone

`gradeGlucoseOnDevice` (same 600 ms budget, bundled `GLUCOSE_CARE_V1` or the approved cached copy under its own key, facts from the phone store including the new `diabetesType`), `evaluateGlucoseOnDevice` (the stricter of the older single-reading check and the engine; a ticked level 3 sign always shows the emergency guidance), a TRI/EMG-style card on the glucose quick-log with the nine sign chips and optional blood and urine ketone entry. The guidance modal shows GLU-E01 or GLU-E02 through the existing wording-code path. Glucose wording has no audio clip (the audio manifest test lists EMG and TRI codes only; the glucose codes are `GLU-` on purpose), so the Listen button hides itself.

Not stored on the server yet: the nine signs. The server's symptom log has no entry for seizure, unconscious, cannot swallow, vomiting or stomach pain, so the phone grades them and the server's shadow grade sees only the four symptoms it can map. The ketone result is stored. See the closeout, which lists this as a point for the CMO before signing.

## 5. Wording and signing

`packages/i18n/src/glucose-wording.json` has its own `signed: null`. Unsigned, `current` is in force and gives no treatment instruction; `proposed` carries the fast-sugar message (15 grams, half a glass of a sweet drink or 3 to 4 teaspoons of sugar or honey, recheck in 15 minutes, taken from the Nigerian draft's examples). Signing the wording is a separate act from signing the rules; today that is a reviewed edit of the JSON by the CMO's instruction, like the EMG/TRI file. A test fails if a build ever sets `signed`.

## 6. Q4 cuff advice

Phone only. When a result asks for a repeat reading (a `recheck_required` result or a `prompt_recheck` action) and the cuff is a wrist cuff or "not sure", the TRI card gains the upper-arm advice (code `CUF-001`, `signed: null` file above). The engine never sees the cuff type, so grading is identical for every cuff; tests pin that a red is the same for all four cuff values and that no red carries the advice. The server's repeat task has no text of its own (the phone renders it), so there is nothing to change on the server, and the repeat reminder notification stays neutral (INV-07).

## 7. Drift and scan tests

- `glucose-drift.test.ts`: the JSON in the seed migration equals `GLUCOSE_CARE_V1`; the migration never approves; every message code resolves in English; the task keys are answered.
- `no-bands-outside-rule-sets.test.ts`: scans apps, packages and edge functions for glucose or BP threshold comparisons and threshold tables; fails for any file not on an explicit, documented, exact-count allowlist (14 legacy or non-triage files, each with a reason); the allowlist can only shrink. `// band-ok: reason` marks a single legitimate line.

## 8. Invariants checked

INV-01 no model anywhere in the path. INV-05 every red carries guidance and a page (validated in the rule set and by a table check). INV-07 the task notification key is the neutral existing one; no glucose wording in any notification. INV-16 every result records the rule set code, version and status. English only, no em dashes (tested), "your care team" not "your doctor" (tested). No notification is required for any glucose feature to work.
