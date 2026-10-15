# Design: testing days, employer on-site visits and point-of-care results

Two-tier model decision D6 (individuals join listed testing days, employers get an on-site visit) and CMO decisions C1, C6, C9 (HIV, HBsAg and anti-HCV every year; ECG and urinalysis at point of care; no vitamin D, ferritin or PSA). Migration `20261013004659_testing_days_employer_visits_point_of_care.sql`; screening fix `20261013005133_membership_annual_screening_required.sql`; proof `packages/db/tests/testing_days_visits_poc.sql`. Nothing here is applied, signed or merged.

## 1. Why a new table family and not group screening days
`screening_days` (20260829003735) is a bulk-paid product: one payer, a discount on a panel bundle, one voucher per head. A Member's testing day is an entitlement use with a capacity and a waitlist, and it makes a lab order at check-in; nothing is paid per head. Reused from it: the `*.manage` permission convention and staff gating. Both visit kinds share one table (`testing_events.kind`) so check-in, specimen labelling, point-of-care entry and release are one path.

## 2. Flow
1. Staff (`testing_days.manage`) create a day: date, venue, address, city and LGA, capacity, lab, team. A day cannot open until the venue is approved (`approve_testing_event_venue`) and the lab is active.
2. Members (active Membership only) see open days (`list_testing_days`), hold a place (`book_testing_day`), join a waitlist when full, cancel (the first person waiting is promoted and told), or reschedule (the old place is kept if the new day is full). One public-day place at a time. Notices in-app, push and email, neutral wording (no test, value or condition). Reminders at 7 days and 1 day come from a daily cron calling `send_testing_day_reminders`.
3. On the day, station A (`testing_days.run`) checks the person in: a `lab_orders` row for panel `membership_annual` (partner fulfilment, transmission queued) and a `lab_specimens` row whose `specimen_number` is the tube label. Once a year: an earlier live annual order blocks a second.
4. Station B enters BP (up to 3 protocol readings), glucose, weight, pulse and SpO2 (written to `vitals_readings`, source device) and height (`poc_measurements`); the urine strip and HbA1c (`poc_results`, classified in the database, held); the ECG file (`poc_ecg_recordings`, private bucket `poc-ecg`).
5. Station C records the blood draw: the specimen becomes collected and the order sample_collected.
6. Employer visit: the employer admin requests (`request_employer_visit`, a week's notice); staff approve the venue, set lab, capacity and team, then add roster employees who have claimed an account and hold a Membership (`add_employer_visit_attendees`; others are counted by reason, not named). Same check-in path. The employer sees counts only (`employer_visit_summary`): any figure under the `min_cell` outcome rule (20) is withheld.

## 3. Release rules (INV-03)
- A patient reads a point-of-care result only when its state is `released` (RLS plus `my_poc_results`).
- Urinalysis and HbA1c: every value is classified by `private.classify_poc_items` from `poc_panel_versions` (PROPOSED, unsigned). A client flag has nowhere to go. All-normal results auto-release only when BOTH the point-of-care panel has an approval AND the lab panels are signed; today neither is, so every result is held with a `routine_result_review` task.
- ECG: never read by software, never auto-released. Recording creates an `ecg_interpretation` task. Only a tied, eligible clinician can write the interpretation; the guard trigger demands a `clinician` login and non-empty text. The patient sees the doctor's class and words, never the machine's printed statement.
- The existing patient-upload ECG pipeline (`ecg_report_documents`, with an AI summary) is a different path and is not used for these traces.

## 4. Screening analytes
`membership_annual` v1 carried HIV screen, HBsAg and anti-HCV as `optional: true` ("only if ordered", the old risk-based design), so a result without them could release as complete. v2 (new immutable version) removes `optional` from exactly those three; the registry entry `lab.panels` is v3 and a mirror test pins the two. HIV and hepatitis positives stay `clinician_disclosure_required`. The unsigned lab sign-off draft names panel v1 and was not touched: the CMO must be shown v2 before signing.

## 5. Not built / decisions needed
- Device models are free text on the entry form (`equipment`), not a catalogue. Which BP monitor, glucometer, HbA1c analyser and ECG machine, and who owns them, is a founder decision (plan section 5.1 lists candidates).
- Venue approval is an explicit step; who approves, and the criteria (access, power, privacy, indemnity), are not defined.
- Station staff who are not admins have no route yet: the station screens live under `/admin` (the proxy admits only admins). Either admit holders of `testing_days.run` to a `/stations` route or make station staff clinician-role accounts.
- Employer attendees are added by pasting roster ids; a roster picker is the obvious next screen.
- The urinalysis scale and its normal readings, and the HbA1c limits, are PROPOSED and need the CMO's approval (`poc_panel_versions.approved_at`; there is deliberately no signing function yet).
- Free people cannot book; whether a Free person may pay for a single testing-day check is not decided.
- Reschedule after check-in, no-show rebooking (the plan says "auto-rebooked to next month"), and the 10-member minimum batch are not implemented.
- Cron: `send_testing_day_reminders` is wired to a daily Vercel cron (`/api/cron/testing-day-reminders`); it has never run against a real provider.
