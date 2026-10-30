# Events harness E8: a lab order from request to a rejected sample

Date: 2026-10-30. Branch `worktree-events-harness-lab-orders-results`. Part of the events harness in
`docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md`. Follows E7 (`EVENTS-HARNESS-E7.md`).

## Scope

`packages/db/tests/s27_lab_results_release.sql` already proves result entry, holding, review and release from every seat, so E8
does not repeat it. E8 covers what surrounds it, from the patient's and the staff member's seat:

1. an order is requested: the patient gets one notice per channel, the email goes to their own address;
2. payment is confirmed: the patient is told, the lab is emailed at the contact on file (and nobody when there is none), and a
   specimen is waiting for collection;
3. a specimen is rejected: only the lab that owns it can reject it, a chained replacement is created, the patient and only the
   Chief Medical Officer are told in the app;
4. an order is marked `sample_rejected` (the older order-level path): a reason is required and frozen, the patient is told, an
   operational alert goes to a care coordinator, and the rejection is audited;
5. every push or email these events queue can be rendered by the sender (the E7 check).

## Findings

1. **Lab order notices arrived twice in the app (fixed by migration).** `private.enqueue_lab_order_lab_notifications` and
   `private.handle_lab_order_sample_rejected` each wrote an explicit in-app row and then a second row on
   `patient_reminder_channel()`, which falls back to the in-app inbox. For a patient with no push subscription and no email
   preference, which is most patients, the bell showed `lab_order_patient_confirmation` and `lab_sample_rejected` twice. Migration
   `20261030094754_lab_order_notices_once_per_channel.sql` sends the own-channel copy only when it adds a channel (push, or email
   for the rejection). Both bodies are the live bodies, compared by checksum with production. Rows already sent are not rewritten.
   **It must be applied to the live database; it is not applied yet.**
2. **Rejected-sample notices had no wording.** The specimen path queues `lab_specimen_rejected_recollection_needed` (patient) and
   `..._staff` (Chief Medical Officer) in the app. Neither had a case in the bell, so the patient saw "You have an update" and the
   CMO saw the same, linking to a patient page. Fixed in `describe-in-app.ts` with fixed wording that shows no reason or number.
3. **The order-level rejection had no push or email renderer (fixed).** `lab_sample_rejected` goes on the patient's own channel,
   which can be push or email, and the sender had no entry for it, so those copies would fail as "unknown template". Added to the
   sender. The word "lab" is blocked by the INV-07 lint on anything a lock screen can show, so the wording says "sample".
4. **A rejected-sample alert is owned by a care coordinator, by design.** The active `laboratory_failure` rule routes it to the care
   coordinator tier with a 24 hour acknowledgement timeout and in-app only. With no coordinator on the roster the alert is
   unassigned but visible to org staff. Not changed; worth knowing when staffing.

## Open, not changed

- **About 30 other producers use the same helper and also write in-app rows.** Only two were confirmed to double up. The rest are
  probably alternatives rather than additions, but none was checked. Found by searching function bodies for both
  `patient_reminder_channel` and an `'in_app'` notification insert: `care_gap_outreach_run`, `enqueue_medication_prescribed_notifications`,
  `enqueue_pharmacy_order_fulfilment_notifications`, `enqueue_pharmacy_order_notifications`, `enqueue_referral_notifications`,
  `evaluate_vitals_monitoring_gaps`, `free_red_notify`, `notify_emergency_followups`, `notify_region_waitlist`,
  `post_consult_checkin_sweep`, `queue_appointment_reminders`, `queue_booking_reminders`, `queue_care_outreach`,
  `queue_diabetes_complication_reminders`, `queue_health_check_due_reminders`, `queue_health_check_rebook_reminders`,
  `queue_lpe_review_reminders`, `queue_medication_*_reminders` (checkin, dose, lab_monitoring, refill, review),
  `queue_preventive_review_reminders`, `queue_screening_reminders`, `queue_triage_recheck_backup_reminders`,
  `queue_vaccination_reminders_when_signed`, `queue_wellness_challenge_ending_nudges`, `sweep_proxy_access_reviews`,
  `symptom_checkback_sweep`, `trigger_population_outreach`. A sweep that fires each producer and counts rows per channel would settle it.
- **The lab alert SMS row.** When a lab provider has a phone on file, the payment trigger also queues an `sms` row. Notification
  SMS is refused by INV-08 and suppressed, so it does nothing but add a row. Harmless; it could be removed.
- **The lab alert email is recorded against the patient** (`recipient_id` is the patient, the lab's address is in the payload).
  It reaches the lab, but it sits in the patient's own notification history and is subject to their settings.

## Not covered

The critical-value call to the on-call clinician (`lab_critical_calls`, covered in two other proofs), the overdue-unreviewed-result
alert (`raise_lab_result_overdue_alerts`) and lab turnaround alerts are not driven here. The result-ready notice is queued in the
app only by `private.lab_notify`; whether the sender fans it out to push was not verified.
