# Audit: D.7 event map and the four journeys (S85, audit half)

Date: 2026-10-07. Branch base: origin/main-dev. Method: repository reading only (migrations, edge function
handlers, apps, tests). No live database was queried and nothing was run, so every "emitted" below means "a
producer exists in committed code", not "seen firing in production". Re-check against the live
`event_types`, `event_subscribers` and `domain_events` before relying on any row.

## 0. What the real event bus is

- `public.event_types` (registry), `event_type_versions` (required payload keys), `domain_events` (outbox),
  `event_subscribers` (subscriber_key, event_type, handler_key), `domain_event_deliveries`. Emit with
  `private.emit_domain_event(...)` (service role). Migration `20261005203441_s10_event_bus_and_outbox.sql`.
- `supabase/functions/process-events` claims deliveries and runs handlers registered in `handlers.ts`.
- **Only six subscribers exist, with five handlers** (`triage.grade_observation`, `queue.create_from_triage`,
  `lead.clinician_event` x3, `lead.assign_on_order_paid`, `paging.create_from_triage`). Every other registered
  event is an outbox row that nothing reacts to. That is the single biggest gap against the D.7 promise that
  "other modules subscribe and react".
- A second, older bus exists: `clinical_rule_events` (enum `clinical_rule_event_type`: `vital_recorded`,
  `medication_dose_recorded`, `medication_dose_missed`, `medication_refill_due`, ...), fed by triggers from
  `20260829093550_clinical_rules_engine_event_emitters.sql` and S08. Vitals and doses feed THIS bus, not
  `domain_events`, except blood pressure (see row 1). Two buses is the root of rows 1 and 2.
- Care Circle red alerts do not ride the bus: `pages_notify_circle` is a trigger on `pages` (S29).

## 1. Event map (D.7.2), row by row

Legend: REG = registered in `event_types`. PRODUCER = committed code emits it. SUB = a subscriber reacts.

| # | D.7.2 event | Event names that exist | Producer | Reactions that exist | Missing or no producer | Verdict |
|---|---|---|---|---|---|---|
| 1 | BP or glucose reading logged (manual, device, USSD) | `observation.recorded` (REG S10), `triage.graded` (REG S10) | `observation.recorded`: trigger `vitals_readings_emit_observation_recorded` (S12), **blood pressure only**, plus symptom regrade trigger. `triage.graded`: `public.record_triage_result` (S12), urgent for red. Glucose: only `clinical_rule_events.vital_recorded` (old bus) and the legacy `vitals_readings_*_red_flag` triggers. | SUB: `triage.grade_observation` (observation.recorded), `queue.create_from_triage` (S16 task), `paging.create_from_triage` (S19, red and not shadow only). Trigger: `pages_notify_circle` (S29). Daily batch: S38 `compute_outcome_snapshots` (reads data, does not subscribe). | Glucose has no `observation.recorded` and no S12 triage. USSD: a `record_source` value exists but no USSD producer or route (USSD was a founder "no", S40 review). "Assistant explains it": no subscriber. "Health Points awarded": no module (S58). "Outcomes engine records it": batch, not event driven. | PARTIAL. BP path is real end to end; glucose, assistant, Health Points missing. |
| 2 | Dose confirmed or missed | `dose.recorded`, `dose.missed` (REG S10), `refill.due` only as a clinical rule enum value | **None for the bus events.** S08 writes `clinical_rule_events` `medication_dose_recorded` / `medication_dose_missed` / `medication_refill_due` / `medication_adherence_low` instead (`private.emit_dose_recorded_event`, `mark_overdue_doses_missed`). | The rules engine worker (shadow) reads the old bus. S12 triage has `trigger_type` values `adherence` and `silence` but no handler subscribes. | `dose.recorded` and `dose.missed` are registered with no producer. Refill countdown and running-low reminder are S08 jobs, not subscribers. | PARTIAL / DRIFT. Registered names are dead; behaviour lives on the old bus. |
| 3 | Symptom check completed | none | none | none. Symptom LOGGING (`symptoms` table) feeds S12 regrade, which is a different thing. | No `symptom_check.completed` event, no checker. | MISSING (blocked by S59/S60). |
| 4 | Consultation completed | `encounter.completed` (REG S10), `note.signed`, `note.released`, `care_plan_change.signed/.confirmed`, `prescription.sent`, `prescription.dispensed`, `async_question.answered` | `encounter.completed`: `complete_encounter` function (S21). `note.*` S22. `care_plan_change.*` S24. `prescription.*` S28. | **None subscribed.** Medicines join the schedule through the S24 `confirm_care_plan_change` function (patient confirms), not through the bus. Prescription to pharmacy is the S28 function, not a reaction. Follow-up tasks: not created from `encounter.completed`. | Subscribers for follow-up task creation and programme-enrolment offer. Programme enrolment offer has no module (S61 to S63). | PARTIAL. Events exist and emit; the "what happens across the platform" part is function calls, not subscriptions. |
| 5 | Lab result received from a partner | `lab_result.received`, `lab_result.released` (REG S10) | S27 (`lab_result.released` x8 sites, `lab_result.received` x4). | None subscribed. Abnormal-before-release is the S27 release state machine (INV-03), proven in DB tests. | Plain-language explanation, screening calendar mark-done, health report and biomarker trend refresh, pathway target review: no subscribers (S27 explain gate is a manual function). | PARTIAL. Emit and gate are real; fan-out is not. |
| 6 | Wearable or device data synced | none on the new bus | Ingest code writes `vitals_readings` / `wearable_readings` (apps/web `lib/wearables/ingest.ts`) which fire the old-bus and legacy triggers. | Legacy pulse red-flag trigger (2026-08-29). | No `device.synced` event. Irregular-rhythm clinician item has no producer (deliberately not built, CLAUDE.md wearables note; S70 not built). | MISSING on the new bus (S70). |
| 7 | Mood or PHQ-9 logged | none | none | none | No mood or PHQ-9 table, no crisis pathway, no event. | MISSING (S56, S57). |
| 8 | Pregnancy recorded | none | none | none | No pregnancy-recorded event. Obstetric status is read on the phone (`obstetric-status.ts`) and S11f has a postpartum window; no module switch, no schedule generator, no threshold switch event. | MISSING (S66 to S68). |
| 9 | Payment completed | `order.paid` (REG S10) | S25 `20261006162206` (4 emit sites incl. webhook path). | SUB: `lead.assign_on_order_paid` (S18). Entitlement is created by the S25/S26 payment trigger and functions, not by a subscriber. | Receipt issuance event, partner settlement scheduling (S72, S74). `entitlement.expiring` is REG with **no producer**. | PARTIAL. Strongest row after BP. |
| 10 | Silence (no activity) | `silence.detected` (REG S10) | **None.** | None. S12 has `trigger_type = 'silence'` in `triage_events` but no producer or handler. The legacy path has `chronic_monitoring_silence` SLA config. | Producer, assistant re-engagement message, triage silence signal for programme members, clinician call prompt. | MISSING (registered, dead). |

### 1.1 Registered with no producer anywhere in committed code

`dose.recorded`, `dose.missed`, `silence.detected`, `entitlement.expiring`, `clinician.task_completed`
(superseded by `clinical_task.completed`), `page.unacknowledged` (superseded by `page.escalated`). Six dead
names in the S10 seed list.

### 1.2 Emitted with no subscriber (outbox only)

Everything except `observation.recorded`, `triage.graded`, `order.paid` and the three clinician events. That
includes `encounter.*`, `note.*`, `lab_result.*`, `prescription.*`, `care_plan_change.*`, `page.*`,
`async_question.*`, `outcome.snapshot_computed`, `content.published`, `translation.reviewed`, `lesson.completed`,
`course.completed`. Not a defect for events that exist only for audit or analytics, but D.7.2 promises
reactions for rows 4, 5, 9 and 10, and those are not subscriptions.

## 2. Journey 2: a red reading at night

| # | Step (spec) | Implemented by | Test that covers it end to end | Blocked by |
|---|---|---|---|---|
| 1 | Member logs 190/120 with a headache | Web: `vitals-form.tsx` -> `vitals_readings` + `symptoms`. Mobile: `vitals-screen.tsx`, `symptom-question-sheet.tsx`, outbox | NEW `journey-2-red-reading.spec.ts` step 1 (web, local stack). Jest: `bp-log.test.ts`, `s11d-symptom-question.test.ts`. | none |
| 2 | Triage grades red before any AI | `emit_bp_observation_recorded` -> `process-events` -> `triage.grade_observation` -> `record_triage_result`; engine in `packages/clinical` | NEW spec step 3 (needs `PROCESS_EVENTS_SECRET` and served edge function). DB: `s12_triage_wiring.sql`, `s11i_bp_care_triage_v3.sql`. Jest: `packages/clinical` tests. | Environment only. Rule set is shadow until CMO signs (OQ-88). |
| 3 | Offline emergency guidance with nearest facilities | Mobile `triage-device.ts` + `emergency-guidance-modal.tsx`; web `emergency-alert.tsx` is the legacy `emergency_events` path | NEW Maestro flow `journey-2-red-reading-offline-guidance.yaml` (written, not run). NEW spec step 2 and offline test (web). Jest: `glucose-red-flags.test.ts`. | Maestro needs an Android device or emulator. "Nearest emergency facilities" list is not on the sheet; it says go to the nearest hospital, with no facility list (copy decision, EMG wording signed #989). |
| 4 | On-call clinician paged through the console | `create_red_page`, `sweep_pages`, `pages`; console: S76/S78 | NEW spec step 4 (asserts no page while shadow). DB: `s19_red_event_paging.sql`, `s19b_on_call_readiness.sql`, race `s19_page_ack_sweep_race.sh`. | Console paging UI is S78 (not built). Seeded clinician fixture OQ-212. |
| 5 | Care Circle contact gets a push alert | `pages_notify_circle` trigger (S29) | DB: `s29_care_circle.sql`, `s29c`. Browser: NEW spec step 5 skipped. | Supporter-session helper missing. |
| 6 | Clinician call and decision recorded | `acknowledge_page`, `close_page`, task complete (S16/S17), `clinical_audit` | DB: `s19`, `s16_clinical_tasks.sql`, `s17_queue_next.sql`. Browser: NEW spec step 6 skipped. | OQ-212. |
| 7 | Next day follow-up consultation booked automatically | **nothing** | none | **Missing producer** (finding F-4). `encounter.scheduled` exists (S21) but no job books it. |
| 8 | Outcomes engine logs the event | S38 daily `compute_outcome_snapshots` | DB: `s38_outcome_snapshots_and_analytics.sql` | No event-driven path (F-5). |

Verdict: steps 1 to 4 and 6 exist and are proven in pieces. Steps 7 and 8 are spec gaps. Journey is NOT
covered end to end by any single test today; the new files cover steps 1 to 4 plus the offline guidance.

## 3. Journey 1: a new user's first month

| # | Step (spec) | Implemented by | Test coverage | Blocked or conflicting |
|---|---|---|---|---|
| 1 | Sign up with phone, verified code, password | `signup`, `auth-send-sms-hook`, mobile `signup-screen.tsx` | Playwright `phone-auth.spec.ts`, Maestro `phone-signup-to-home.yaml` | none |
| 2 | Onboarding asks goals; selects blood pressure | `onboarding/intent-step.tsx` (3 intents: manage, prevent, unsure) | Playwright `b2c-signup-to-entitlement.spec.ts` (picks "not sure yet"); NEW journey 1 test asserts the manage intent exists | **Conflict**: no goal list with blood pressure (F-1). |
| 3 | Risk questionnaire places her at high CV risk | `cvd-risk-check.tsx`, `patient_risk_scores` | none end to end | Not a journey-shaped flow (F-6). |
| 4 | Screening calendar shows Essential screen due | `screening_schedules` (prevention) | none | "Essential screen" product not linked to risk result (F-6). |
| 5 | Books SYNLAB collection point, pays at checkout | lab orders (S27), orders/Paystack (S25), booking | DB: `s25`, `s27`. Playwright checkout initiation (skips without `sk_test` key) | Paystack test key. Real orders only with test key. |
| 6 | Clinician reviews raised creatinine before release | S27 release state machine (INV-03) | DB: `s27_lab_results_release.sql`, `s27c`, `s27d`, `s27g` | OQ-212 for a browser test. |
| 7 | Results in Passport, explained in Pidgin audio | Health passport; S32 audio manifest | DB/Jest for manifest | **Stale**: Pidgin removed 2026-10-06, English only (F-2). |
| 8 | Logs home BP daily from Today screen | `vitals-form.tsx` (web), `vitals-screen.tsx` (mobile) | NEW journey 1 test (one reading); Jest `bp-log.test.ts` | none |
| 9 | Earns Health Points for consistency | none | none | S58 not built. |
| 10 | Average above target -> offered hypertension care pack | care packs (S25/S26), S38 90-day control | none | No offer producer (F-7). |
| 11 | Son in London joins Care Circle and pays by card | S29, S29b gifted pack, `create_order` beneficiaries | DB: `s29_care_circle.sql`, `s29b`, `s29c` | Supporter-session helper; Paystack key. |

## 4. Journey 3: from symptom to treatment

| # | Step | Implemented by | Test | Blocked by |
|---|---|---|---|---|
| 1 | Symptom checker structured questions, causes with frequency, urgency grade | none | none | **S59, S60** |
| 2 | Offers asynchronous consultation | S22 written questions | DB `s22_written_questions_and_notes.sql` | Entry point S59/S60 |
| 3 | Doctor sees symptom summary | S35 clinician patient summary | DB `s35_clinician_patient_summary.sql` | S59/S60 produce no summary; OQ-212 |
| 4 | Confirms likely UTI, requests urine test | S27 lab orders | DB `s27` | OQ-212 |
| 5 | Prescribes (signed) | S24 (INV-02) | DB `s24_prescriptions_and_care_plan_changes.sql`, `s24b` | none for DB |
| 6 | Prescription to chosen pharmacy for collection | S28 | DB `s28_pharmacy_collection_and_dispensing.sql`, `s28c` | **No active pharmacy partner** |
| 7 | Course added to medicine schedule | S24 `confirm_care_plan_change` -> S08 medicines | DB `s24`, `s08` | none for DB |
| 8 | Assistant checks in on day three | none | none | Missing producer |
| 9 | Monthly accuracy audit compares checker and diagnosis | S38e triage accuracy (different measure) | DB `s38e` | S59/S60 store no suggestion |

## 5. Journey 4: an employer programme

| # | Step | Implemented by | Test | Blocked by |
|---|---|---|---|---|
| 1 | Company enrols 300 staff with a cohort code | `employer_roster_members` (phone match), S38e `sponsor_cohorts`; no code redemption | Playwright `employer-eligibility.spec.ts` (public checker only) | **S79**; a cohort code does not exist (F-9) |
| 2 | Staff get sponsored care packs and consultations as entitlements | S26 entitlements, sponsor gifting | DB `s26`, `s29b` | S79 grant path |
| 3 | Company sees aggregate participation and outcomes in institution console | S38e/S38f sponsor report and staff monthly figures (small-cell suppression) | DB `s38e`, `s38f` | **S79** (no institution console) |
| 4 | Never individual records, never reproductive or mental health data | RLS; I9 | DB `s36a` style negatives exist for staff roles, none for an institution role | S79; mental health data (Module 10) does not exist yet |

## 6. Findings (for OPEN-QUESTIONS, not fixed here)

- F-1 Journey 1 step 2 names a "blood pressure" goal selection. Onboarding has three intents, no goal list.
- F-2 Journey 1 step 7 says Pidgin audio. Pidgin was removed 2026-10-06. Rewrite the journey line.
- F-3 Event map rows 2 and 10: `dose.*` and `silence.detected` are registered and never emitted; behaviour sits on
  the old `clinical_rule_events` bus. Decide: emit on the new bus, or retire the names.
- F-4 No producer books a follow-up consultation after a red event (Journey 2 step 7).
- F-5 No event-driven outcomes record for a red event; S38 is a daily batch.
- F-6 Risk questionnaire and "Essential screen due" are not one flow; the Essential screen is not tied to a risk grade.
- F-7 Nothing offers a care pack when the BP average stays above target.
- F-8 Recommend a repo scan test that `supabase/functions/_shared/triage` and `packages/clinical` import no model
  client (INV-01 is currently enforced by convention and review, not by a failing test that I could find).
- F-9 "Cohort code" has no counterpart. Decide between a redeem code and the roster before S79.
- F-10 Glucose readings are not triaged by S12 (`observation.recorded` is BP only), yet D.7.2 row 1 says
  "blood pressure or glucose".
- F-11 Only six event subscribers exist; rows 4, 5, 9 describe fan-out that is function calls today.

## 7. New tests added this session

- `apps/web/e2e-browser/journeys/journey-2-red-reading.spec.ts`: 5 live tests (reading saved, guidance visible,
  red grade with rule set version, page or deliberate no-page under shadow, offline notice) and 4 skipped with blockers.
- `apps/web/e2e-browser/journeys/journey-1-first-month.spec.ts`: 3 live tests, 8 skipped with blockers.
- `journey-3-...` and `journey-4-...`: skip-only, each with the blocker named.
- `apps/mobile/.maestro/flows/journey-2-red-reading-offline-guidance.yaml`: written, not run.
- Status of all: type-checked and linted only (`tsc --noEmit`, eslint on the new folder). Not executed.
