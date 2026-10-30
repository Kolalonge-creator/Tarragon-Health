# Screening scheduler and automatic test requests: clinical safety case and hazard log

Status 2026-10-29: **v1.0 was signed by the CMO, Dr Kola Longe, in a Claude Code chat on 2026-10-29 and recorded through the owed sign-offs ledger (`owed_signoffs`, subject `screening_safety_case_v1`, signed at the CMO's instruction with the word SIGN and a note).** The ratings are the CMO's own. v0.1 had earlier been accepted by instruction in chat, and the screening guards were switched on then. On the day of switch-on one real patient (no sex or date of birth on file) was skipped by the scheduler. Since then HZ-SCR-01 (Members), HZ-SCR-03 and HZ-SCR-06 have been addressed in code (see the table); the Free-tier remainder of HZ-SCR-01 and HZ-SCR-07 and HZ-SCR-08 are open.

Version: **v1.0, signed 2026-10-29 by the Chief Medical Officer.** Drafted by the assistant from the live function bodies and the signed rule set; not reviewed by an independent clinical safety officer. Nothing here claims compliance with a standard. Severity and likelihood are residual levels after the controls listed.

**A v1.1 DRAFT section follows the signed v1.0 text below. It is unsigned and is not covered by the v1.0 signature.** Everything above it is v1.0 exactly as signed.

Guards this document supports: `screening_scheduler_enabled` and `screening_request_automation_enabled` (both read the attested condition `clinical_safety_case_current`; the second one also needs the first).

## What the two jobs do (read from the live definitions on 2026-10-29)

1. **Nightly scheduler** (`private.run_screening_scheduler`, 02:15 UTC). For every active patient with a date of birth and a sex on file, it applies the signed, active screening rule set (v3, signed 2026-10-29) through `private.screening_due` and inserts `screening_schedules` rows (status `pending`). It only schedules rules marked `autoSchedule` and not `isOptional`.
2. **Nightly request automation** (`private.run_screening_request_automation`, 02:45 UTC). For each schedule that is `pending` or `overdue` and due, with no order yet, and for a **non-sensitive** test that maps to a single-test bundle, it creates a `lab_orders` row (`fulfilment = self_arranged`, `total_kobo = 0`). The patient prints the request and takes it to any lab. Tarragon does not book, bill or collect. A **sensitive** test (HIV, hepatitis B and C and others flagged `sensitive`) is never auto-issued unless a second guard and the patient's own opt-in are both on. That guard (`screening_sensitive_request_optin_enabled`) was switched ON on 2026-10-29 at the CMO's instruction; at that time 0 patients had opted in and 0 sensitive requests had been issued.
3. Reminders already exist (`screening-reminders-daily`). Abnormal results already raise a clinician alert on entry (`handle_abnormal_screening_result`, proven by `abnormal_screening_result_upgrade.sql`).

## Hazards

| ID | Hazard | Cause | Possible harm | Control today | Check | Gap | Severity | Likelihood | Owner |
|---|---|---|---|---|---|---|---|---|---|
| HZ-SCR-01 | A test is done at an outside lab and the result never reaches Tarragon | The patient takes a printed request to any lab; no lab integration exists; the result enters only if the patient uploads it | An abnormal result (for example FIT, HbA1c, lipid) is never seen, so a clinician never files it and any abnormal-result alert never fires | A printed request carries an upload step on the calendar and in the test-request list. Reminders chase until a result is uploaded (upcoming, due, overdue at +6 days, escalated at +20 days with a push); uploading stops them and raises a clinician review alert; a doctor files the values, which then trend for the patient and the care team | `screening_outside_lab_upload_to_trend.sql` proves the path end to end as the real roles; `abnormal_screening_result_upgrade.sql`, `screening_result_recall.sql` | **Closed for Members (updated 2026-10-29, #1421, task type confirmed live).** When the chase reaches its last stage a care coordinator task `screening_result_chase` follows up, once per schedule (`screening_result_chase_task.sql`). **Still open by design:** a Free patient gets every reminder but no care-team task, because Free uses no doctor time, so a Free upload has nobody to file it and no alert. The CMO decides whether that is acceptable | High | Possible (Free: Likely) | CMO, product |
| HZ-SCR-02 | A rule sends the wrong test to the wrong person | A rule's sex or age bound is wrong, or the profile sex or date of birth is wrong | Unneeded test, or a needed one missed | Rules are signed data, not code; sex and age checked in `screening_due`; `screening_ladder_order_completeness` and `s47_screening_risk_based` proofs | `s47_screening_risk_based.sql` | The cervical milestone ages (35 and 45) and the HIV retest interval were not read from the national guideline (v3 notes). The CMO signed with that knowledge | Moderate | Possible | CMO |
| HZ-SCR-03 | A patient with no date of birth or sex gets nothing, silently | `screening_due` returns no rows when either is missing | A person is never screened and nobody knows | Each full nightly run counts the real active patients it skipped for a missing date of birth or sex, writes one `audit_log` row (a count) and opens one sev3 incident owned by the CMO, named no patient (migration `20261029215729`) | `screening_scheduler_skipped_profiles_alert.sql` (with sabotage) | Closed in code once that migration is live. The alert tells a person to find the patients in the admin patient directory; nothing yet nudges the patient to complete their profile | Moderate | Unlikely | Engineering |
| HZ-SCR-04 | Over-testing | Rules auto-schedule abdominal ultrasound every 24 months and a resting ECG yearly for every adult from 18, breast imaging every 24 months from 18, and a wide blood panel yearly | Cost to patients, incidental findings, anxiety | Patient can decline (`screening_decline.sql`); request is free to Tarragon but not to the patient at the lab | `screening_decline.sql` | The frequencies are the CMO's clinical choice in v3; no evidence review is attached | Low | Likely | CMO |
| HZ-SCR-05 | A sensitive test is auto-issued or its reminder reveals it | A sensitive flag missing on a screen type; a reminder names the test | Disclosure of HIV or hepatitis testing to someone else | Auto-issue skips `sensitive` types unless the opt-in guard and a patient opt-in exist (the guard is ON since 2026-10-29, accepted by the CMO; 0 patients opted in and 0 issued at that date); reminders follow the neutral wording rule | `s98_preventive_test_request_automation.sql` | Reminder wording for sensitive items should be rechecked by the CMO and DPO now that the opt-in guard is on | High | Unlikely (only after a patient opts in) | CMO, DPO |
| HZ-SCR-06 | Auto-request fails for some patients without anyone noticing | An exception in the per-row block | Patients silently not issued a request | The failure is counted, written to `audit_log` and opens one `ops_incidents` row (sev3), naming no patient | `s98_preventive_test_request_automation.sql`, `screening_scheduler_skipped_profiles_alert.sql` | Closed: the incident is owned by the active CMO by instruction on 2026-10-29. Reassign when ops has a named person | Moderate | Unlikely | Ops |
| HZ-SCR-07 | A request names no usable lab | Patient has no lab nearby; Tarragon has no partner lab for the test | Patient cannot get the test | The request carries `where_to_get` guidance; partner labs are used only where a contract exists | none | Coverage of rural areas is not assessed | Moderate | Possible | Ops |
| HZ-SCR-08 | Scheduling starts for a large group at once | First nightly run creates schedules for everyone eligible | A burst of reminders and requests | At the time of writing the platform has about 5 real patients | none | Re-assess before opening to the public | Moderate | Unlikely with staged rollout, Likely without | Engineering |

Severity and likelihood above are **proposed by the assistant on 2026-10-29 at the CMO's request**, as the residual level after the controls listed. They are the CMO's to change; signing below means the CMO has read and accepted or amended them.

## Decisions recorded 2026-10-29 (CMO, in chat)

- **HZ-SCR-04:** the screening frequencies in rule set v3 are kept as signed.
- **HZ-SCR-08:** public opening is staged. Patients are admitted in invitation batches (`pilot_invites`) so that each night's scheduler run covers a small, known group. The scheduler has no per-night cap of its own; staging is by who is allowed in, not by a limit in code.

## Switch-on conditions the CMO is asked to confirm

- The rule set v3 content has been read and is accepted (signed 2026-10-29).
- HZ-SCR-01 (Free tier remainder) is understood and accepted, or a decision is recorded to give Free patients a follow-up.
- HZ-SCR-03 and HZ-SCR-06 incidents are owned by the CMO (done in code; reassign when ops has a named person).
- HZ-SCR-08: staged rollout by invitation batch is the control (decided above). Re-assess the batch size after the first batch's first nightly run.
- The severity and likelihood cells above are confirmed or changed by the CMO.

## Sign-off

Reviewed and signed by: Dr Kola Longe  Role: Chief Medical Officer  Date: 2026-10-29  Version: v1.0

Signed in a Claude Code chat session and recorded in the owed sign-offs ledger (`owed_signoffs`, subject `screening_safety_case_v1`); the ledger row carries the CMO's note and the audit entry `owed_signoff.signed`. The alert code this version relies on (HZ-SCR-03, HZ-SCR-06) went live with PR #1435 (migration `20261029215729`).

---

# v1.1 DRAFT: additions to the signed v1.0 (UNSIGNED)

**Status: draft for the Chief Medical Officer to read. Nothing in this section is covered by the v1.0 signature above. It becomes v1.1 only when the CMO reads it, corrects it and signs it.** It adds what v1.0 does not say. It changes no signed text and no rating. Prepared by the assistant on 2026-10-29. The CMO, who is also the DPO and the founder, is the only reviewer of this platform; no second reader is required (decision recorded 2026-10-29), and the residual risk of having no independent check is stated here once and gates nothing.

## A. Scope v1.0 does not cover

v1.0 supports the scheduler and the request automation. Three further switches are on and have **no safety case of their own**: `reproductive_content_enabled` (reproductive education and the clinician cycle report), `sleep_apnoea_screen_enabled` (snoring and daytime sleepiness questionnaire; the STOP-Bang licence from University Health Network is not verified, risk accepted in chat), and `mental_health_follow_up_enabled` (wellbeing follow-up tasks). Each was attested in chat. Decision for the CMO: write a short safety case for each, or keep them on knowingly. Until then they are outside every hazard above.

## B. State on the day of switch-on (checked in the live database, 2026-10-29)

- Real active patients 5; real active Members 1; 1 real patient missing sex or date of birth.
- Screening schedules created 0; automatic requests issued 0. **No real traffic had gone through the pipeline.** The first nightly run (02:15 UTC for the scheduler, 02:45 for requests) is the first test on real data.
- Sensitive screen types today (the opt-in applies to all of them): abdominal ultrasound, breast imaging, cervical smear, chlamydia and gonorrhoea, clinical breast exam, colonoscopy, echo, FIT, hepatitis B, hepatitis C, HIV, mammography, prostate ultrasound, PSA, syphilis. Reminders show "a screening test" instead of the name for these (verified in the live function body). Not checked: the wording of the printed request itself, the lab-order screens, and push or email subjects other than the reminder template.

## C. Additional hazards

| ID | Hazard | Cause | Possible harm | Control today | Check | Gap | Severity / likelihood | Owner |
|---|---|---|---|---|---|---|---|---|
| HZ-SCR-09 | A patient confirms a wrong number on their own chart | The patient edits a value extracted from their report and mistypes it, or confirms a number they did not read | A wrong value shown to a doctor or used to reassure the patient | The value is shown labelled as reported by the patient; it carries no flag and no reference range; it never enters the clinical record or any alert; HIV and hepatitis marker results are excluded and left to the care team; the code must be one present on the uploaded report | `patient_reported_lab_values.sql` | The only value check is that it is a number between 0 and 1,000,000. No per-test plausibility range, so a plainly impossible value is accepted. Nothing compares it with the uploaded file | Low / Possible (s) | Engineering |
| HZ-SCR-10 | A clinical switch is on without the responsible person having signed | Switches were pressed from a chat session on instruction, not from the hub | A control believed to be signed is not | A database guard refuses a governed configuration going live unsigned (#1432). Four owed-signature lines were kept on the hub until signed; all four are now signed in chat | `governed_config_never_live_without_signature.sql`, `owed_signoffs_ledger.sql` | A signature entered in a chat session records the CMO's instruction, not the CMO pressing Sign on the hub; the notes say so. The hub does not raise a line automatically when a go-live switch is pressed. 67 AI guardrails and 5 AI knowledge sources are live with no approval and are outside the guard | Moderate / Unlikely (s) | CMO, engineering |

Ratings marked `(s)` are the assistant's suggestion.

## D. First-run check (suggested)

After 02:45 UTC on the first night, read: schedules created and for whom (only patients with sex and date of birth on file, and only for rules actually due); `lab_orders` with `fulfilment = self_arranged`; screening `ops_incidents` (expect one sev3 for the patient with no sex or date of birth, owned by the CMO); and that no notification names a sensitive test. If anything is unexpected, switch `screening_request_automation_enabled` off first, then the scheduler.

## E. v1.1 sign-off

Reviewed and signed by: ____________________  Role: Chief Medical Officer  Date: __________  Version: v1.1

## Change log

- v0.1, 2026-10-29: first draft, accepted in chat, never signed.
- v1.0, 2026-10-29: signed by the CMO (see above).
- v1.1 draft, 2026-10-29: scope gap, state on switch-on, HZ-SCR-09, HZ-SCR-10 and first-run check added; unsigned.
