# Screening scheduler and automatic test requests: clinical safety case and hazard log

**Version: v1.0 DRAFT FOR THE CHIEF MEDICAL OFFICER TO READ. NOT SIGNED.**

This is the version you are asked to read, change and sign. It replaces v0.1 (29 October, accepted in a chat, never signed). It is not a clinical safety officer review, and nothing in it claims compliance with a standard. It was prepared by the assistant on 2026-10-29 from the live function bodies, the live database and the proofs in the repository. Where a statement could not be checked, it says so. If you sign, you sign the version you have read, with your own corrections written into it; the hub line "Screening scheduler safety case: sign version 1.0" then records that you did.

Severity and likelihood cells carry **suggested** values from the assistant. They are clinical judgements. Change any you disagree with.

## 1. What changed since v0.1 (all on 2026-10-29)

| Change | Effect on this safety case |
|---|---|
| Six switches are now ON, not two: `screening_scheduler_enabled`, `screening_request_automation_enabled`, **`screening_sensitive_request_optin_enabled`**, `reproductive_content_enabled`, `sleep_apnoea_screen_enabled`, `mental_health_follow_up_enabled` | v0.1 said the sensitive opt-in guard "stays off". **It is on.** HZ-SCR-05 is rewritten. The last three are not covered by this document (see section 2). |
| A patient can confirm the numbers on a report they uploaded themselves (`patient_reported_lab_values`); they show on their own chart labelled as reported by them | New hazard HZ-SCR-09. HZ-SCR-01 control extended. |
| A Member whose request reaches the escalated stage gets a care-coordinator task (`screening_result_chase`; you confirmed the task type) | HZ-SCR-01 control extended. |
| Uploads made while Free are routed to a doctor when the person becomes a Member (trigger on membership start) | HZ-SCR-01 residual hazard narrowed. |
| Sex and date of birth are mandatory: the database already refused to finish onboarding without them; the web onboarding now surfaces that refusal; the phone app has a gate screen that asks for them before anything else | HZ-SCR-03 partly mitigated. |
| Mammography is active as an **optional** screen; typhoid removed from the vaccination catalogue; three adult vaccine drafts exist **inactive** and unverified | HZ-SCR-04 note. Vaccine drafts are not part of this switch-on. |
| The nightly run now counts real active patients it skipped for a missing date of birth or sex, writes a count-only audit row and opens one sev3 incident; both screening incidents are owned by the active CMO (#1435, migration `20261029215729`, live) | HZ-SCR-03 and HZ-SCR-06 closed in code. |
| A database guard now refuses any governed configuration going live without a signature (PR #1432), and an owed-signatures ledger lists this document on your sign-off hub | The governance gap that let this go live on a chat instruction is closed for configuration rows. |

## 2. Scope

**In scope:** the nightly scheduler, the nightly request automation, the reminder ladder, the sensitive-test opt-in, the outside-lab upload and patient-confirmed values, the Member chase task, and Free-to-Member routing of earlier uploads.

**Not in scope, and not covered by any safety case today:** the reproductive content and clinician cycle report, the snoring and daytime sleepiness questionnaire (its STOP-Bang licence is unverified, hub line "Sleep questionnaire: STOP-Bang licence"), and the wellbeing follow-up tasks. Their switches are on. They were attested in chat. Either each gets its own short safety case, or you decide to switch it off until it does.

## 3. What the jobs do (read from the live definitions on 2026-10-29)

1. **Nightly scheduler** (`private.run_screening_scheduler`, 02:15 UTC). For every active patient with a date of birth and a sex on file, it applies the signed, active rule set (v3, signed 2026-10-29) through `private.screening_due` and inserts `screening_schedules` rows with status `pending`. It schedules only rules marked `autoSchedule` and not `isOptional`.
2. **Nightly request automation** (`private.run_screening_request_automation`, 02:45 UTC). For each schedule that is `pending` or `overdue`, due, with no order yet, and whose test maps to a single-test bundle, it creates a `lab_orders` row (`fulfilment = self_arranged`, `total_kobo = 0`). The patient prints the request and takes it to any lab. Tarragon does not book, bill or collect. A **sensitive** screen type is issued only with the patient's own opt-in; with the opt-in guard on, that is now possible.
3. **Reminders** (`private.queue_screening_reminders`, daily): upcoming (7 days before), due, overdue (after 6 days), escalated (after 20 days, adds a push). Uploading a result stops them. For a sensitive screen type the reminder carries the words "a screening test", not the test name (verified in the live function body).
4. **Abnormal results** raise a clinician alert when a doctor files the values (`handle_abnormal_screening_result`, proven by `abnormal_screening_result_upgrade.sql`).

The screen types flagged `sensitive` today are: abdominal ultrasound, breast imaging, cervical smear, chlamydia and gonorrhoea, clinical breast exam, colonoscopy, echo, FIT, hepatitis B, hepatitis C, HIV, mammography, prostate ultrasound, PSA, syphilis. This is a wider list than HIV and hepatitis. Many ordinary screens therefore go through the opt-in.

## 4. State on the day of switch-on (checked in the live database)

- Real active patients: **5**. Real active Members: **1**.
- Real patients missing sex or date of birth: **1** of 5. The scheduler skips this person; the first full nightly run will count and report them (HZ-SCR-03).
- Screening schedules created so far: **0**. Automatic requests issued so far: **0**. **No real traffic has gone through this pipeline yet.** The first nightly run is the first test on real data.
- Operations incidents about screening: **0** at the time of checking; the skipped-patient incident opens on the first full nightly run.

## 5. Hazards

Severity and likelihood for HZ-SCR-01 to HZ-SCR-08 are the levels the assistant proposed on 2026-10-29 at the CMO's request (residual, after the controls listed); one is changed here and marked. HZ-SCR-09 and HZ-SCR-10 are new suggestions marked `(s)`. All are the CMO's to change.

| ID | Hazard | Cause | Possible harm | Control today | Check | Gap that remains | Severity / likelihood | Owner |
|---|---|---|---|---|---|---|---|---|
| HZ-SCR-01 | A test is done at an outside lab and the result never reaches the care team | The patient takes a printed request to any lab; no lab integration exists; the result enters only if the patient uploads it | An abnormal result (FIT, HbA1c, lipids and others) is never seen; no alert fires | The request carries an upload step. Reminders chase until a result is uploaded (see section 3). An upload stops them and raises a clinician review alert. A doctor files the values; they then trend for patient and care team. **New:** a Member whose request reaches the escalated stage gets a coordinator task. **New:** uploads made while Free are routed to a doctor when the person becomes a Member | `screening_outside_lab_upload_to_trend.sql`, `screening_result_chase_task.sql`, `membership_start_routes_prior_uploads.sql`, `abnormal_screening_result_upgrade.sql`, `screening_result_recall.sql` | (a) A **Free** patient's upload waits for a doctor to file it, with no stated time limit; the chase task is Members only. (b) The alert fires when a doctor files, not on upload. (c) No standing proof that closing a shared membership alert on review works. (d) Only 1 Member exists today, so the chase has never run for real. The CMO decides whether the Free remainder is acceptable or Free patients get a follow-up | High / Possible (Free: Likely) | CMO, product |
| HZ-SCR-02 | A rule sends the wrong test to the wrong person | A rule's sex or age bound is wrong, or the profile sex or date of birth is wrong | Unneeded test, or a needed one missed | Rules are signed data. Sex and age are checked in `screening_due`. Only female and male are offered as sex, so a person who is neither gets the nearest option | `s47_screening_risk_based.sql`, `screening_ladder_order_completeness.sql` | The cervical milestone ages (35 and 45) and the HIV retest interval were not read from the national guideline (v3 notes); you signed knowing that. The sex field cannot express intersex or non-binary people | Moderate / Possible | CMO |
| HZ-SCR-03 | A patient with no date of birth or sex gets nothing, silently | `screening_due` returns no rows when either is missing | A person is never screened and nobody knows | **New:** the database refuses to finish onboarding without both, the web onboarding shows that refusal, the phone app gates on both. These catch new sign-ups and existing users the next time they open the app | `complete-onboarding-refused.test.ts`, phone `demographics.test.ts`, `screening_scheduler_skipped_profiles_alert.sql` (with sabotage) | Closed in code: each full nightly run counts the real active patients it skipped, writes one `audit_log` row (a count, no names) and opens one sev3 incident owned by the CMO. **Remaining:** nothing nudges a patient who never opens the phone app or web onboarding; one real patient stays skipped until they complete their profile or someone follows the incident up | Moderate / Unlikely | Engineering |
| HZ-SCR-04 | Over-testing | Rules auto-schedule abdominal ultrasound every 24 months, a resting ECG yearly for every adult from 18, breast imaging every 24 months from 18, and a wide blood panel yearly | Cost to patients, incidental findings, anxiety | The patient can decline. The request is free to Tarragon but not to the patient at the lab. Mammography is optional and not auto-scheduled | `screening_decline.sql` | The frequencies are your clinical choice in v3; no evidence review is attached | Low / Likely | CMO |
| HZ-SCR-05 | A sensitive test is issued to the wrong person, or its existence is disclosed | A screen type flagged sensitive is auto-issued without consent; a message or document names the test to someone who should not see it | Disclosure of HIV, hepatitis, STI, cancer-screening or sexual-health testing | Auto-issue of a sensitive type needs the patient's own opt-in as well as the guard. Reminders say "a screening test" for any sensitive type (verified live, section 3) | `s98_preventive_test_request_automation.sql` | **The guard is ON, and v0.1's condition to recheck wording first was not done.** Not checked: the wording of the printed request itself, the lab-order screens, push and email subjects other than the reminder template, and what a care-circle member or dependant guardian can see. The DPO review was recorded as your word in chat. You are the CMO, the DPO and the founder, and there is no second person to review (decision recorded 2026-10-29), so you are the sole reviewer | High / **Unlikely (raised from Rare because the guard is now on, s)** | CMO, DPO |
| HZ-SCR-06 | Auto-request fails for some patients without anyone noticing | An exception in the per-row block | Patients silently not issued a request | The failure is counted, written to `audit_log` and opens one `ops_incidents` row (sev3) naming no patient | `s98_preventive_test_request_automation.sql`, `screening_scheduler_skipped_profiles_alert.sql` | Closed: the incident is owned by the active CMO, by instruction on 2026-10-29. Reassign when operations has a named person | Moderate / Unlikely | Ops |
| HZ-SCR-07 | A request names no usable lab | The patient has no lab nearby; Tarragon has no partner lab for the test | The patient cannot get the test | The request carries `where_to_get` guidance. Partner labs are used only where a contract exists | none | Coverage outside the main cities is not assessed | Moderate / Possible | Ops |
| HZ-SCR-08 | Scheduling starts for many people at once | The first nightly run creates schedules for everyone eligible | A burst of reminders and requests | Today the platform has 5 real patients | none | Staged by invitation batch (decision in section 6); re-assess the batch size after the first batch's first nightly run. The first run on 5 patients is the only real test so far | Moderate / Unlikely with staged rollout, Likely without | Engineering |
| HZ-SCR-09 | A patient confirms a wrong number on their own chart | The patient edits a value extracted from their report and mistypes it, or confirms a number they did not read | A wrong value shown to a doctor or used to reassure the patient | The value is shown labelled as reported by the patient; it carries no flag and no reference range; it never enters the clinical record or any alert; HIV and hepatitis marker results are excluded and left to the care team; the code must be one present on the uploaded report | `patient_reported_lab_values.sql` | The only value check is that it is a number between 0 and 1,000,000. There is no per-test plausibility range, so a plainly impossible value is accepted. A doctor sees the label but nothing compares it with the uploaded file | minor / possible (s) | Engineering |
| HZ-SCR-10 | A clinical switch is on without the responsible person having signed | Switches were pressed from a chat session on instruction, not from the hub | A control believed to be signed is not | **New:** a database guard refuses a governed configuration going live unsigned (#1432). **New:** four lines on your sign-off hub keep this document, the six switches, the sleep licence and the vaccine drafts counted until you sign them | `governed_config_never_live_without_signature.sql`, `owed_signoffs_ledger.sql` | The hub does not yet raise a line automatically when a go-live switch is pressed; the 67 AI guardrails and 5 AI knowledge sources live without approval are outside this guard | significant / unlikely (s) | CMO, engineering |

## 6. Decisions recorded 2026-10-29 (CMO, in chat)

- **HZ-SCR-04:** the screening frequencies in rule set v3 are kept as signed.
- **HZ-SCR-08:** public opening is staged. Patients are admitted in invitation batches (`pilot_invites`) so that each night's scheduler run covers a small, known group. The scheduler has no per-night cap of its own; staging is by who is allowed in, not by a limit in code.
- **HZ-SCR-03 and HZ-SCR-06:** both screening incidents are owned by the active CMO until operations has a named person.

## 7. Conditions you are asked to confirm before signing

- [ ] You have read the rule set v3 and accept it (signed 2026-10-29).
- [ ] HZ-SCR-01 (a) and (d) are understood as open: a Free patient's upload waits for a doctor, and the Member chase has not yet run on a real person.
- [ ] HZ-SCR-03: the skipped-patient incident is yours to follow up; one real patient is skipped today. Decide who contacts them.
- [ ] **HZ-SCR-05:** you are the only reviewer, by decision (no second person exists). Read the printed request and the lab-order screens for a sensitive test yourself, or switch the opt-in guard off until you have. You accept that no independent check exists: ____________________
- [ ] The CMO owning the two screening incidents is accepted for now; name a person when operations has one: ____________________
- [ ] You have decided what happens to the reproductive content, sleep and wellbeing switches (section 2): own safety case, or switch off until there is one.
- [ ] You will look at the first nightly run's result (section 8) before the second.

## 8. First-run check (suggested)

After 02:45 UTC on the first night, read: the number of `screening_schedules` created and for whom (expect schedules only for patients with sex and date of birth on file, 4 of the 5, none for the fifth, and only for rules actually due); the number of `lab_orders` with `fulfilment = self_arranged`; any `ops_incidents` about screening (expect one sev3 for the patient with no sex or date of birth, owned by the CMO); and that no notification names a sensitive test. If anything is unexpected, switch `screening_request_automation_enabled` off first, then the scheduler.

## 9. Sign-off

I have read this document, corrected anything I disagree with in the text above, and accept the open items in section 7 with the named owners.

Reviewed and signed by: ____________________  Role: Chief Medical Officer  Date: __________  Version: v1.0

Sole reviewer: the CMO, DPO and founder is the only person who signs or reviews anything on this platform (decision recorded 2026-10-29); no second reader is required.

## Change log

- v0.1, 2026-10-29: first draft by the assistant, accepted by the CMO in chat, never signed.
- v1.0 draft, 2026-10-29: second-reader requirement removed (sole reviewer by decision); reconciled with #1435 (skipped-patient alert, CMO-owned incidents, recorded decisions, proposed ratings) and updated for the six switches now on, the patient-confirmed values and Member chase, Free-to-Member routing, mandatory sex and date of birth, and the signature guard; state on the day of switch-on added; HZ-SCR-05 rewritten (guard is on); HZ-SCR-09 and HZ-SCR-10 added; suggested ratings added.
