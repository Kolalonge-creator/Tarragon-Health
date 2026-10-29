# Screening scheduler and automatic test requests: clinical safety case and hazard log

Status 2026-10-29: **v0.1 was accepted by the CMO, Dr Kola Longe, by instruction in a Claude Code chat, and the screening guards were switched on. The signature block below is still unsigned and v1.0 has not been issued.** The attestation recorded in `go_live_attestations` says exactly that. HZ-SCR-01 and HZ-SCR-03 remain open gaps; on the day of switch-on one real patient (no sex or date of birth on file) is skipped by the scheduler.

Version: **v0.1 DRAFT. Prepared by the assistant on 2026-10-29 from the live function bodies and the signed rule set. Not reviewed by a clinical safety officer. It becomes v1.0 only when the Chief Medical Officer reads it, amends it and signs it.** Nothing here claims compliance with a standard. Severity and likelihood cells are left for the clinical owner.

Guards this document supports: `screening_scheduler_enabled` and `screening_request_automation_enabled` (both read the attested condition `clinical_safety_case_current`; the second one also needs the first).

## What the two jobs do (read from the live definitions on 2026-10-29)

1. **Nightly scheduler** (`private.run_screening_scheduler`, 02:15 UTC). For every active patient with a date of birth and a sex on file, it applies the signed, active screening rule set (v3, signed 2026-10-29) through `private.screening_due` and inserts `screening_schedules` rows (status `pending`). It only schedules rules marked `autoSchedule` and not `isOptional`.
2. **Nightly request automation** (`private.run_screening_request_automation`, 02:45 UTC). For each schedule that is `pending` or `overdue` and due, with no order yet, and for a **non-sensitive** test that maps to a single-test bundle, it creates a `lab_orders` row (`fulfilment = self_arranged`, `total_kobo = 0`). The patient prints the request and takes it to any lab. Tarragon does not book, bill or collect. A **sensitive** test (HIV, hepatitis B and C and others flagged `sensitive`) is never auto-issued unless a second guard and the patient's own opt-in are both on; that guard stays off.
3. Reminders already exist (`screening-reminders-daily`). Abnormal results already raise a clinician alert on entry (`handle_abnormal_screening_result`, proven by `abnormal_screening_result_upgrade.sql`).

## Hazards

| ID | Hazard | Cause | Possible harm | Control today | Check | Gap | Severity | Likelihood | Owner |
|---|---|---|---|---|---|---|---|---|---|
| HZ-SCR-01 | A test is done at an outside lab and the result never reaches Tarragon | The patient takes a printed request to any lab; no lab integration exists; the result enters only if the patient uploads it or a clinician records it | An abnormal result (for example FIT, HbA1c, lipid) is never seen, so the abnormal-result upgrade never fires | Reminders and the overdue status keep the item open; an abnormal result entered later does escalate | `abnormal_screening_result_upgrade.sql`, `screening_result_recall.sql` | **No control detects a test that was done but not reported.** The patient is the only route back | _CMO_ | _CMO_ | CMO, product |
| HZ-SCR-02 | A rule sends the wrong test to the wrong person | A rule's sex or age bound is wrong, or the profile sex or date of birth is wrong | Unneeded test, or a needed one missed | Rules are signed data, not code; sex and age checked in `screening_due`; `screening_ladder_order_completeness` and `s47_screening_risk_based` proofs | `s47_screening_risk_based.sql` | The cervical milestone ages (35 and 45) and the HIV retest interval were not read from the national guideline (v3 notes). The CMO signed with that knowledge | _CMO_ | _CMO_ | CMO |
| HZ-SCR-03 | A patient with no date of birth or sex gets nothing, silently | `screening_due` returns no rows when either is missing | A person is never screened and nobody knows | None in the scheduler itself | none | **Gap.** No count or alert of active patients the scheduler skipped for missing data | _CMO_ | _CMO_ | Engineering |
| HZ-SCR-04 | Over-testing | Rules auto-schedule abdominal ultrasound every 24 months and a resting ECG yearly for every adult from 18, breast imaging every 24 months from 18, and a wide blood panel yearly | Cost to patients, incidental findings, anxiety | Patient can decline (`screening_decline.sql`); request is free to Tarragon but not to the patient at the lab | `screening_decline.sql` | The frequencies are the CMO's clinical choice in v3; no evidence review is attached | _CMO_ | _CMO_ | CMO |
| HZ-SCR-05 | A sensitive test is auto-issued or its reminder reveals it | A sensitive flag missing on a screen type; a reminder names the test | Disclosure of HIV or hepatitis testing to someone else | Auto-issue skips `sensitive` types unless the opt-in guard and a patient opt-in exist (guard is off); reminders follow the neutral wording rule | `s98_preventive_test_request_automation.sql` | Reminder wording for sensitive items should be rechecked before the opt-in guard is ever switched on | _CMO_ | _CMO_ | CMO, DPO |
| HZ-SCR-06 | Auto-request fails for some patients without anyone noticing | An exception in the per-row block | Patients silently not issued a request | The failure is counted, written to `audit_log` and opens one `ops_incidents` row (sev3), naming no patient | `s98_preventive_test_request_automation.sql` | Nobody is assigned to the incident by default | _CMO_ | _CMO_ | Ops |
| HZ-SCR-07 | A request names no usable lab | Patient has no lab nearby; Tarragon has no partner lab for the test | Patient cannot get the test | The request carries `where_to_get` guidance; partner labs are used only where a contract exists | none | Coverage of rural areas is not assessed | _CMO_ | _CMO_ | Ops |
| HZ-SCR-08 | Scheduling starts for a large group at once | First nightly run creates schedules for everyone eligible | A burst of reminders and requests | At the time of writing the platform has about 5 real patients | none | Re-assess before opening to the public | _CMO_ | _CMO_ | Engineering |

## Switch-on conditions the CMO is asked to confirm

- The rule set v3 content has been read and is accepted (signed 2026-10-29).
- HZ-SCR-01 and HZ-SCR-03 are understood as open gaps with a named owner and a date.
- Someone is named to receive the sev3 incident of HZ-SCR-06.

## Sign-off

Reviewed and signed by: ____________________  Role: Chief Medical Officer  Date: __________  Version: v1.0
