# Safety cases for three switches that went on without one, and the sensitive-test visibility review

**Status: DRAFT, UNSIGNED. Prepared by the assistant on 2026-10-30 for the Chief Medical Officer (also the DPO and the founder, and the sole reviewer of this platform; no second reader is required).** It becomes real only when the CMO reads it, corrects it and signs it. Nothing here claims compliance with a standard. Ratings marked `(s)` are the assistant's suggestions and are the CMO's to change.

These three switches were turned on on 2026-10-29 from a chat session, with their cover and timing conditions attested by the CMO's word. The screening safety case (v1.0, signed; v1.1 draft) does not cover them (its section A says so). This document gives each one a short case so that "on" has a written basis, and records one review the CMO asked to be done for the screening switches.

**What was checked and what was not.** From the live database on 2026-10-30: each switch is on; what the switch gates and what it does not (`go_live_guards.blocks`, `enforced_in`, `not_enforced_in`); the attestations recorded. **Not checked by me:** the clinical wording shown to patients, the rota that provides cover, and the behaviour of each feature against real patients (none has run on real data yet).

---

## A. Reproductive education and clinician cycle report (`reproductive_content_enabled`)

**What it gates:** the contraception education page and the clinician cycle pattern report. **Not behind it:** the cycle tracker, menopause log, planning mode and the private section lock; they are live regardless.
**Enforced in:** every call to `read_reproductive_pattern_report_audited` (every report read is audited) and a courtesy check on the education page.

| ID | Hazard | Control today | Gap | Rating (s) |
|---|---|---|---|---|
| RP-01 | A person's cycle or fertility information is read by someone who should not see it | Every clinician report read is audited; `reproductive_health` is a protected access category that emergency access never opens | Not re-checked by me today. The protection is only as good as the access categories granted to guardians and caregivers | High / Unlikely |
| RP-02 | Contraception or menopause education is wrong, or read as personal medical advice | The CMO reviewed the wording as a condition of switch-on (in chat) | The wording is not reproduced here and I did not read it; no clinician review date is recorded in the database | Moderate / Possible |
| RP-03 | The cycle pattern report is read as a diagnosis | It is a clinician-facing pattern report, not a patient result | No statement on the report that it is not diagnostic was checked | Moderate / Unlikely |

**Open for the CMO:** accept, or switch off until the wording and the access categories have been re-read.

## B. Snoring and daytime sleepiness questionnaire (`sleep_apnoea_screen_enabled`)

**What it gates:** the questionnaire and the referral task it can create. **Not behind it:** the sleep diary, wind-down planner and library.
**Enforced in:** `submit_sleep_apnoea_screen` and `get_sleep_apnoea_instrument`. **Cut-off:** 3 of 8, confirmed by the CMO.

| ID | Hazard | Control today | Gap | Rating (s) |
|---|---|---|---|---|
| SL-01 | The instrument (STOP-Bang, University Health Network) is used without a licence | None | **The licence position is not verified; risk accepted in chat.** This is a legal question, not a clinical one | Moderate / Likely (until verified) |
| SL-02 | A positive screen creates a referral task nobody works | Cover for the referral tasks attested by the CMO's word | The rota was not independently checked; no task has been created yet | Moderate / Unlikely |
| SL-03 | A negative screen is taken as proof of no sleep apnoea | It is a screening questionnaire with a stated cut-off | The patient-facing wording was not read by me | Moderate / Possible |

**Open for the CMO:** verify or accept the licence risk; accept the cover attestation.

## C. Wellbeing follow-up tasks (`mental_health_follow_up_enabled`)

**What it gates:** the follow-up task created after a moderate or high PHQ-9, GAD-7 or EPDS result (trigger `mental_health_screens_follow_up_task`).
**Not behind it (live regardless, per the guard record):** the crisis path (any self-harm answer), the older clinician alert for moderate and high results, the crisis card and every screen.

| ID | Hazard | Control today | Gap | Rating (s) |
|---|---|---|---|---|
| MH-01 | A moderate or high result gets no follow-up | The older clinician alert still fires for these results; the new task adds a timed follow-up on top | Follow-up timings (`mental_health_follow_up_config`) and the clinician cover were confirmed by the CMO's word; the rota was not independently checked | High / Unlikely |
| MH-02 | A self-harm answer is missed | The crisis path is not behind this switch and is live regardless | I relied on the guard record for that statement; I did not re-test the crisis path today | Critical / Rare |
| MH-03 | Follow-up tasks land on a clinician who is not on cover | Cover attested | As MH-01 | High / Unlikely |

**Open for the CMO:** accept the cover attestation, or re-test the crisis path and check the rota before leaving it on.

---

## D. Sensitive-test visibility review (the open item of HZ-SCR-05, done by the assistant)

The question: who can see that a sensitive test (HIV, hepatitis, PSA, cervical smear and the rest of the list in the screening safety case) has been requested for someone?

**Verified:**
- Reminders (`private.queue_screening_reminders`) put "a screening test" in the notification payload instead of the test name for any sensitive screen type, and the push, email and in-app templates only read that payload field (`screen_type_name`, `describe-in-app.ts`, `send-pending-notifications/templates.ts`). So no reminder names a sensitive test.
- The request itself must name the test, because the lab needs it. That is not a defect, but it means the request is the place a name can leak.
- `lab_orders` can be read by: the patient; organisation staff; a person with the `labs_results` access category (care circle); emergency access for `labs_results`; and a caregiver with the `view_results` permission. So **an automatically issued request for a sensitive test is visible to a family member or caregiver who has been given lab-result access.**
- Right now: 0 patients have opted in to automatic sensitive requests and 0 sensitive requests have been issued, so no one is exposed today.

**Not verified:** the exact patient opt-in screen and its wording.

**The decision this leaves the CMO** (no second reader needed):
1. **Accept.** A caregiver already sees lab results; a request is the same kind of information. The opt-in is the patient's own choice.
2. **Narrow.** Keep automatic issue for non-sensitive tests only, and switch `screening_sensitive_request_optin_enabled` off until a caregiver-visibility rule for sensitive requests exists.

---

## Sign-off (each section is signed separately by marking it here)

Reviewed and signed by: ____________________  Role: Chief Medical Officer  Date: __________

Sections signed (A, B, C, D): __________

## Change log

- 2026-10-30, draft: sections A, B, C and D written by the assistant; unsigned.
