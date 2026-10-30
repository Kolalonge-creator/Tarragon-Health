# Events harness: sweep of the notice producers

Date: 2026-10-30. Branch `worktree-events-harness-duplicate-notices`. Follows E8 (`EVENTS-HARNESS-E8.md`), which found two lab
producers writing the same in-app notice twice and listed about 30 others that use the same helper. This is that sweep.

## Method

1. Listed every function in `public` and `private` whose body both calls `private.patient_reminder_channel` and inserts into
   `notifications` (about 70, read from the live database, not from the repo).
2. For each, split the body at every `insert into public.notifications` and recorded the kind of each insert (a row on the patient's
   reminder channel, an explicit `'in_app'` row, or other), the template, and whether the reminder-channel row is guarded
   (`... <> 'in_app'`, `= 'push'`, or a lateral join doing the same).
3. Read the exact text of the in-app insert of each suspect to check for a hidden guard.
4. Cross-checked against production: identical in-app notices (same recipient, template and payload) queued in the same minute.

**Not done: firing each producer.** Most need their own fixtures (a due reminder, an appointment, a referral). The classification below
is from the function text plus production data, and says which is which.

## Why it doubles

`patient_reminder_channel()` returns email if the patient prefers it, else push if they have a subscription, else the in-app inbox.
A producer that writes an explicit in-app row (so the inbox always has a copy) and then also a row on that channel writes the
in-app notice twice for any patient with no email preference and no push subscription. That is most patients. The correct shape is
what `queue_screening_reminders` has after #1468: in-app always, plus the channel copy only `where the channel <> 'in_app'`.

## Result

**Doubles the in-app notice (unguarded channel row plus in-app row, same template, same recipient), 22 functions, plus one to confirm:**

| Producer | Template(s) | Evidence |
| --- | --- | --- |
| `queue_medication_checkin_reminders` | `medication_adherence_checkin` | production: 4 of 4 groups doubled, up to 6 |
| `enqueue_medication_prescribed_notifications` | `medication_prescribed_patient`, `prescription_updated_patient` | production: 6 in-app rows for 3 prescriptions |
| `queue_medication_refill_reminders` | `medication_refill_reminder` | text |
| `queue_medication_review_reminders` | `medication_review_due` | text |
| `queue_medication_dose_reminders` | `medication_dose_reminder` | text |
| `queue_medication_lab_monitoring_reminders` | `medication_lab_monitoring_due` | text |
| `queue_preventive_review_reminders` | `preventive_review_due` | text |
| `queue_health_check_due_reminders` | `health_check_due_soon` | text |
| `queue_health_check_rebook_reminders` | `health_check_rebook_due` | text |
| `queue_diabetes_complication_reminders` | `diabetes_complication_check_due` | text |
| `queue_lpe_review_reminders` | `lifestyle_review_due` | text |
| `queue_wellness_challenge_ending_nudges` | `wellness_challenge_ending` | text |
| `queue_booking_reminders` | `booking_reminder` | text |
| `queue_care_outreach` | `care_outreach_checkin` | text |
| `queue_vaccination_reminders_when_signed` | `vaccination_upcoming`, `_due`, `_overdue`, `_escalated` | text, four templates |
| `post_consult_checkin_sweep` | `consult_checkin_due` | text |
| `symptom_checkback_sweep` | `symptom_checkback_due` | text |
| `enqueue_pharmacy_order_notifications` | `pharmacy_order_patient_confirmation` | text; same shape as the lab confirmation fixed in E8 |
| `enqueue_pharmacy_order_fulfilment_notifications` | pharmacy fulfilment notices | text |
| `enqueue_referral_notifications` | `referral_patient_confirmation` | text; same shape as the lab confirmation |
| `notify_region_waitlist` | `region_now_available` | text |
| `notify_emergency_followups` | `emergency_followup` | production: 2 of 4 groups doubled, up to 4 |
| `sweep_proxy_access_reviews` | `proxy_review_due` | text (the second row is for a different recipient; confirm) |
| `queue_appointment_reminders` | `appointment_reminder_for_dependent` | not a double: the in-app row is for a different recipient |
| `queue_triage_recheck_backup_reminders` | `triage_recheck_due` | two in-app inserts, probably different recipients; confirm |

"text" means the function body writes both rows with no guard, confirmed by reading each insert's source and condition for the medication, review, health-check, diabetes, lifestyle, wellness, booking and care-outreach producers. For `queue_vaccination_reminders_when_signed`, `post_consult_checkin_sweep`, `symptom_checkback_sweep`, the two pharmacy producers, `enqueue_referral_notifications`, `notify_region_waitlist` and `notify_emergency_followups` only the kind of each insert was extracted, not the in-app insert's own condition, so treat them as likely, not confirmed. None has been fired. The last three rows are listed so they are not
re-investigated: the first two are probably fine, and `sweep_proxy_access_reviews` is the one to look at.

**Already correct:** `queue_screening_reminders` (fixed by #1468; production shows 109 doubled `screening_due` groups, all created in
the one run this morning before that fix), `trigger_population_outreach` (guarded through a lateral join), the two lab producers
(fixed in E8), `escalate_diagnostic_follow_up_non_completion` (guarded).

**Single-row producers (no explicit in-app row), cannot double:** about 35 others, including `cancel_appointment`,
`confirm_appointment_booking`, `reschedule_appointment`, the membership renewal notices, `sweep_followups`, `queue_vitals_reminders`,
`queue_annual_reviews` and the imaging and ECG report notices.

## Other findings from the production data

1. **`clinician_alert_sla_breach` goes twice to anyone who is both a Chief Medical Officer and an admin.** 206 of 828 groups, to one
   recipient. `escalate_overdue_clinician_alerts` notifies every active CMO, then every admin, and a person in both lists gets both.
2. **Two escalation jobs notify admins of every organisation.** `escalate_overdue_clinician_alerts` and
   `escalate_unacknowledged_clinician_alerts` select `profiles where role = 'admin'` with no organisation filter;
   `raise_unread_clinical_message_alerts` does filter. Production has two organisations (the real one and a synthetic canary), and it has
   already happened both ways: 130 notices about the real organisation's alerts (SLA breach 64, escalation exhausted 65, AI system
   disabled 1) went to the canary organisation's admin, and 25 canary notices went to the real admin. The messages carry the alert title,
   not a patient name. The canary may be relying on the real admin being paged, so this needs a decision, not a blind filter.
3. **`red_event_guidance_waiting` is 1392 rows, all doubled, for one recipient.** That recipient is "Canary patient" in the synthetic
   organisation: it is the chain canary running every 3 minutes, not patient traffic. Not a patient-facing problem; the doubling is
   probably two sweeps both calling `red_patient_notify` for the same watch.

## Fix options

- **A. Fix each producer** the way #1468 and E8 did: in-app always, channel copy only when the channel is not in-app. Twenty-odd function
  rewrites, each from its live body, each needing its own proof. Safe and local; slow, and the next producer someone writes can
  repeat it.
- **B. One guard on the table.** A `BEFORE INSERT` trigger on `notifications` that drops an in-app row identical (recipient, template,
  channel, payload, source) to one already inserted in the same transaction. Fixes every producer, including future ones, in one small
  change with one proof. Cost: a lookup on every in-app insert, and it hides a producer bug instead of removing it. Needs testing that
  it sees rows written by sibling CTEs of the same statement.

## Not covered

No producer was fired. The `text` rows above should be confirmed by whichever fix is chosen (the proof for A or B fires them).
