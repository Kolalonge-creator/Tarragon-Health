# Events harness E9: repeat and renewal requests

Date: 2026-10-30. Branch `worktree-events-harness-prescriptions-renewals`. Part of the events harness in
`docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md`. Follows E8 (`EVENTS-HARNESS-E8.md`).

## Scope

Prescribing, amendment and expiry notices are already proven by `prescription_amended_and_expiring_notices.sql`. The eligibility
and approval rules for a repeat are proven by `medication_repeat_requests.sql`, and the pharmacy chain by
`pharmacy_engine_end_to_end.sql`. What had no proof is the loop between a patient and their doctor when the patient asks for more.
`packages/db/tests/events_repeat_and_renewal_request_loop.sql` reads it from each person's seat:

1. **Repeat request.** The patient asks; their own doctor sees it as pending; the patient sees it; another patient does not; a
   patient cannot ask on someone else's behalf.
2. **Decision.** A patient cannot approve their own request. The doctor approves and the row is stamped with who and when. The
   patient can read the outcome. A denial needs a reason, and the patient can read it. A decided request cannot be decided again.
3. **Renewal request.** A patient with no membership and no renewal credit is sent to Membership. A Member's own request is closed
   in favour of the monthly review. A care coordinator cannot decide one; a doctor can, stamped; the Member reads the outcome.
4. **What is not told.** Asserts, as a fact that must be edited on purpose to change, that no step of the above queues a
   notification today.

## Findings

No bugs were found in what exists; the access rules and the stamping behave as intended, and sabotage runs (disabling the review
trigger; queuing a repeat notification) fail the proof where expected. The findings are about what is missing.

1. **Nobody is told about a request or its answer.** A repeat or renewal request queues no notification to the doctor, and neither
   an approval nor a denial queues one to the patient. The doctor finds a request through the worklist count (submitted and in-review
   renewals); the patient finds the answer, and for a denial the reason, by opening the app. `CLAUDE.md` does not require a notice
   for this, so it is a product decision rather than a defect. A patient who is waiting for a refill of a regular medicine and
   is declined with a reason will not learn it until they look.
2. **A renewal request's due time is not enforced.** `prescription_renewal_requests.sla_due_at` defaults to 72 hours after the
   request, but no database function or scheduled job reads it, so a request that goes past it raises nothing. The worklist badge
   counts open requests and does not distinguish late ones.
3. **Renewal rows for a Member cannot be created by a doctor.** Row security lets only the patient insert, and the trigger refuses
   a Member's own insert ("Your doctor reviews renewals at your monthly call"). The trigger's comment says a row created by a
   doctor, staff member or service job is the monthly-review route, but only a service job (or the system) can write one. No
   database function inserts renewal rows, so for a Member the monthly review today runs through `add_review_note`, not a request row.
   Worth confirming that is the intent.

## If a notice is added

Section 4 of the proof will fail, on purpose. Change it to assert the notice arrives once per channel, then add its template to the
E7 and E8 style checks (sender renderer or locale row for any push or email, and bell wording for any in-app notice), and mind the
duplicate-row pattern fixed in E8 (an explicit in-app row plus a row on `patient_reminder_channel()`).

## Not covered

The pharmacy order chain, refill and dose reminders, controlled-medicine handling and the pharmacist's questions to the prescriber
are covered by other proofs or not at all, and are not driven here.
