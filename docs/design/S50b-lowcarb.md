# S50b part 2: the low-carbohydrate programme for type 2 diabetes (spec 6.10, decision S50-2)

Built end to end, **live for nobody**. The go-live guard `low_carb_t2d_programme` is born OFF. Never marketed. Every medicine change is signed by a clinician (INV-02) and confirmed by the patient. No language model anywhere (INV-01).

## Reconciliation (live, 2026-10-21)

| Need | Live object | Decision |
|---|---|---|
| Programme, eligibility, check-ins | none (grep for `low_carb`, `ketone`, `titration`, `deprescri`, `programme` found only the BP titration engine S24, the glucose triage rules R2 and the fasting work in another PR) | New: 3 tables, 1 config table |
| Ketone readings | vital type `ketones` exists (0 to 20 mmol/L) | Reused. No new reading store. |
| Medicine proposals | S24 `care_plan_changes`, `protocols`, `propose_care_plan_change` (supports `stop`) | Reused. A diabetes step table is a DRAFT row in `protocols` (code `t2d_lowcarb_deprescribing`). The S24 evaluator itself is blood-pressure shaped (systolic and diastolic readings), so the glucose evaluator is a sibling pure function using the same row shape, not a fork of the BP one. |
| Review task | S16 `task_types` and `create_clinical_task` | New task type `lowcarb_medicine_review` (PROPOSED), `needs_confirmation = false` on purpose (a pending confirmation would block `approve_triage_rule_set` for every rule set; no triage rule creates this task). |
| Pregnancy, postnatal year, eating-disorder screen | `patient_pregnancy`, `postnatal_profiles`, `reproductive_health_profiles`, `obesity_ed_screens` | Read only inside definer functions as a yes or no; the clinician door turns a pregnancy reason into `health_condition` unless `staff_may_read(... 'reproductive_health')`. |
| Emergency and red path | R2 glucose triage, `triage_events`, pages | Untouched. The programme adds a pause beside it. |

## The gate (S48a and S49a patterns)

- Pure: `packages/clinical/src/lowcarb-programme.ts` (100 percent branch tested). DB twin: `private.lowcarb_eligibility_for()`. 26 shared case ids (L01..L26) pinned by `lowcarb-parity.test.ts`.
- Decisions: `eligible`, `needs_supervision` (insulin, sulfonylurea: a doctor accepts supervision with a note), `not_now` (red or amber result in the last 72 hours), `not_eligible`, `unavailable` (no signed rules).
- Patient door `my_lowcarb_gate()` answers `ok` or `unavailable`, and `unavailable` is one answer for not offered, not live, not signed and guard closed (as S49a). It returns the status, the check-in cadence and the low-sugar line, never a pause reason.
- A patient cannot self-enrol. A prescribing clinician tied to the patient offers; only the patient answers (`respond_lowcarb_offer`); accepting re-runs the screen and the guard.

## Safety

- A red or amber `triage_events` row, a glucose below the pause line, or ketones at or above the pause line PAUSES an active enrolment, opens (or joins) one `lowcarb_medicine_review` task, and sends the patient a neutral notice (INV-07). The ketone pause does not wait for a symptom entry: it pauses on the number alone, the more careful direction.
- A resume is a clinician's act and re-runs the whole screen (a new red result blocks it). After a low sugar or ketone pause it also needs a medicine review recorded since the pause.
- The patient door keeps answering `ok` for anyone already on the programme even if the guard is switched off, so the low-sugar card and the Stop button never vanish; the guard hides only an unanswered offer. An offer lapses after 14 days.
- A clinician the category-scoped path does not entitle to reproductive health sees one vague reason for every `not_eligible`, so the answer cannot reveal a pregnancy.
- Three pauses in 30 days, or 14 days without a check-in, STOP it. A stop always opens a medicine review. The check-in sweep (`private.lowcarb_sweep()`) is written and proven but not scheduled (OQ-S50B-3).
- Triggers swallow their own errors by design (a reading must still save) but every failure opens a `sev2` ops incident (`lowcarb_programme_safety`). A failed review task never undoes a pause.

## Medicines (INV-02)

`proposeLowCarbMedicineReview` reads signed rules and a step table and returns triggers plus suggestions. A suggestion is either `stop` (can become an unsigned draft `care_plan_changes` row through `propose_care_plan_change`, engine proposer, clinician-issued medicines only) or `review_dose` (a note; the platform never computes a dose). Real patients need an APPROVED table; a draft drives test patients only. `approve_protocol` refuses `placeholder: true`, so the shipped draft can never be approved as it stands: the CMO writes the real one.

## Screens

- Clinician: `LowCarbProgrammePanel` on the patient chart (renders nothing until the guard is on or an enrolment exists), with offer, pause, resume, stop, "Check the medicines", and "Record the review". Drafts appear in the existing Care plan changes panel.
- Patient: `/patient/lowcarb` (offer with equal yes and no buttons, today's check-in, what to do if low, reach your care team, stop). Reachable through a link on the medicines page that exists only for someone who has been offered it.
- CMO: `/clinician/lowcarb-protocol-config` and the sign-off hub line. Admin read-only copy at `/admin/settings/lowcarb-protocol-config`.
- Phone: `LowCarbScreen` (not in the drawer; a quiet link on Medicines for someone who was offered it). Logging goes to the existing Vitals screen and its offline outbox. See OQ-S50B-5.
- Medicine classification: groups in the config, fuzzy match, and a fail-safe (an unrecognised diabetes-looking medicine needs supervision). See OQ-S50B-6.
