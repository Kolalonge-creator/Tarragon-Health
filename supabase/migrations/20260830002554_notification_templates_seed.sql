-- Health Communication Engine — central template registry seed (part 4).
--
-- Seeds public.notification_templates with every template key found live
-- across the platform (send-pending-notifications/index.ts's TEMPLATE_MAP,
-- notification-bell.tsx's describe(), and every queue_*/enqueue_*/trigger
-- function that inserts a notifications row directly) as of this pass, plus
-- the new care_message_safety_flag template from the companion safety-
-- screening migration. category/business_priority/audience/default_channels
-- are launch-time governance defaults, not extracted from any formal sign-
-- off process — same "flagged for review" posture this codebase already
-- uses for escalation_slas/alert_rules v1. An admin can revise any row
-- through the normal RLS-gated update path; requires_clinical_approval is
-- left false for all of them here (none is retroactively marked approved —
-- that stays a real Clinical Director action via
-- public.approve_notification_template(), never backfilled by a migration).
--
-- Deliberately NOT seeding notification_template_locales for these ~89
-- pre-existing templates: doing so accurately would mean transcribing the
-- real copy out of a 1,987-line Edge Function and a second TSX file
-- verbatim, and an inaccurate transcription in a table whose own header
-- calls it "authoritative" would be worse than an honest gap. The locale
-- table stays ready (17.6 architecture) for new templates added going
-- forward — see the DB-fallback branch in send-pending-notifications.
--
-- Excludes three strings apps/mobile/src/lib/notifications.ts switches on
-- (medication_refill_due, family_access_request, escalation_resolved) that
-- a full-codebase search found no actual insert path for — see the
-- investigation this migration is based on. If one of those turns out to
-- be real (an insert path this pass missed), register it then rather than
-- guessing its metadata now.
insert into public.notification_templates
  (key, category, business_priority, audience, default_channels, description)
values
  ('abnormal_result_clinician_alert', 'clinical', 'critical', 'clinician', array['push','whatsapp','sms','in_app']::public.notification_channel[], 'Doctor alert for an abnormal/critical screening result (Category 2->1 upgrade).'),
  ('annual_review_consult_scheduled', 'clinical', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'Video-consult slot confirmed for the Annual Health Review.'),
  ('annual_review_due', 'administrative', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Annual Health Review cycle opened or due.'),
  ('appointment_booking_confirmation', 'operational', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'Appointment booking confirmed.'),
  ('appointment_cancelled', 'operational', 'important', 'patient', array['whatsapp']::public.notification_channel[], 'Appointment cancelled.'),
  ('appointment_provider_cancelled', 'operational', 'important', 'patient', array['whatsapp']::public.notification_channel[], 'Provider-initiated appointment cancellation.'),
  ('appointment_reminder', 'operational', 'important', 'patient', array['whatsapp']::public.notification_channel[], 'Scheduled appointment reminder (72h/24h/2h/shortly-before).'),
  ('appointment_rescheduled', 'operational', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'Appointment rescheduled.'),
  ('appointment_waiting_list_offer', 'operational', 'important', 'patient', array['whatsapp']::public.notification_channel[], 'A waiting-list slot became available.'),
  ('async_consult_answered', 'referral', 'routine', 'patient', array['whatsapp','sms']::public.notification_channel[], 'Doctor answered an ask-a-doctor question.'),
  ('booking_reminder', 'operational', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Facility booking reminder.'),
  ('broadcast_announcement', 'administrative', 'marketing', 'patient_or_partner', array['email','sms','whatsapp']::public.notification_channel[], 'Admin-authored broadcast/announcement to a selected audience.'),
  ('care_access_manage_request', 'operational', 'important', 'patient', array['in_app']::public.notification_channel[], 'A family member requested manage-level care access.'),
  ('care_access_request_accepted', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'A care-access request was accepted.'),
  ('care_access_request_declined', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'A care-access request was declined.'),
  ('care_access_revoked', 'operational', 'important', 'patient', array['in_app']::public.notification_channel[], 'A care-access grant was revoked.'),
  ('care_access_view_request', 'operational', 'important', 'patient', array['in_app']::public.notification_channel[], 'A family member requested view-level care access.'),
  ('care_message_safety_flag', 'clinical', 'critical', 'clinician', array['in_app','push','whatsapp','sms']::public.notification_channel[], 'Proactive page when a care message matched the deterministic safety screen (17.12).'),
  ('care_outreach_checkin', 'operational', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Proactive care-gap outreach check-in.'),
  ('care_voucher_expiring', 'administrative', 'routine', 'patient', array['in_app','email','whatsapp','sms']::public.notification_channel[], 'A care voucher is expiring soon.'),
  ('clinical_staff_indemnity_lapse', 'administrative', 'urgent', 'admin', array['in_app']::public.notification_channel[], 'A clinician''s indemnity cover is expiring or has lapsed.'),
  ('clinical_staff_license_lapse', 'administrative', 'urgent', 'admin', array['in_app']::public.notification_channel[], 'A clinician''s practising license is expiring or has lapsed.'),
  ('clinician_alert_ack_timeout_admin', 'clinical', 'urgent', 'admin', array['in_app']::public.notification_channel[], 'Unacknowledged clinician alert, 3rd escalation rung.'),
  ('clinician_alert_ack_timeout_backup', 'clinical', 'urgent', 'clinician', array['in_app']::public.notification_channel[], 'Unacknowledged clinician alert, 1st escalation rung (backup clinician).'),
  ('clinician_alert_ack_timeout_senior', 'clinical', 'urgent', 'clinician', array['in_app']::public.notification_channel[], 'Unacknowledged clinician alert, 2nd escalation rung (senior/clinical director).'),
  ('clinician_alert_sla_breach', 'clinical', 'urgent', 'clinician', array['in_app']::public.notification_channel[], 'An open clinician alert breached its resolution SLA.'),
  ('clinician_care_plan_task', 'operational', 'important', 'clinician', array['in_app']::public.notification_channel[], 'A care plan needs clinician review.'),
  ('clinician_new_care_message', 'operational', 'important', 'clinician', array['in_app']::public.notification_channel[], 'A patient/sponsor message the assigned clinician has not seen.'),
  ('clinician_new_referral', 'referral', 'important', 'clinician', array['in_app']::public.notification_channel[], 'A new specialist referral needs triage.'),
  ('critical_notification_escalation_exhausted', 'clinical', 'critical', 'admin', array['in_app']::public.notification_channel[], 'A critical alert went unconfirmed on every channel in its escalation ladder.'),
  ('data_breach_deadline', 'administrative', 'urgent', 'admin', array['in_app']::public.notification_channel[], 'The NDPC 72-hour breach-notification deadline is approaching or passed.'),
  ('diabetes_complication_check_due', 'clinical', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Diabetes retinal/renal complication check is due.'),
  ('emergency_card_expiring_soon', 'administrative', 'routine', 'patient', array['in_app','email']::public.notification_channel[], 'Emergency card live link is expiring soon.'),
  ('emergency_card_viewed', 'administrative', 'routine', 'patient', array['in_app','email']::public.notification_channel[], 'Emergency card link was viewed/scanned.'),
  ('emergency_contact_alert', 'clinical', 'critical', 'patient_emergency_contact', array['sms','whatsapp']::public.notification_channel[], 'Urgent next-of-kin alert for an emergency event.'),
  ('emergency_event_clinician_alert', 'clinical', 'critical', 'clinician', array['push','whatsapp','sms','in_app']::public.notification_channel[], 'An emergency_events row was raised.'),
  ('emergency_followup', 'clinical', 'urgent', 'patient', array['whatsapp']::public.notification_channel[], 'Check-in after a reported emergency.'),
  ('free_tier_reading_self_care_suggestion', 'clinical', 'urgent', 'patient', array['in_app']::public.notification_channel[], 'Self-care nudge for a dangerous reading on the Free plan (no doctor escalation).'),
  ('health_check_due_soon', 'operational', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Annual Health Check bundle due in about a month.'),
  ('health_check_rebook_due', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'Time to rebook a recurring health check.'),
  ('health_education_unlock', 'education', 'routine', 'patient', array['in_app']::public.notification_channel[], 'New health-education lesson(s) unlocked.'),
  ('health_passport_attestation_declined', 'administrative', 'important', 'patient', array['in_app']::public.notification_channel[], 'A passport attestation request was declined.'),
  ('health_passport_attested', 'administrative', 'important', 'patient', array['in_app','email']::public.notification_channel[], 'A passport attestation was completed.'),
  ('health_passport_revoked', 'administrative', 'urgent', 'patient', array['in_app','email']::public.notification_channel[], 'A health passport credential was revoked.'),
  ('health_passport_verified', 'clinical', 'important', 'patient', array['in_app']::public.notification_channel[], 'An uploaded vaccination certificate was verified against the passport.'),
  ('health_reset_complete', 'education', 'routine', 'patient', array['in_app']::public.notification_channel[], 'The 90-Day Health Reset programme is complete.'),
  ('lab_order_lab_alert', 'laboratory', 'routine', 'partner_lab', array['sms','email']::public.notification_channel[], 'A new paid lab order needs preparing.'),
  ('lab_order_patient_confirmation', 'laboratory', 'routine', 'patient', array['whatsapp','email','in_app']::public.notification_channel[], 'Lab order payment confirmed.'),
  ('lab_order_requested_patient', 'laboratory', 'important', 'patient', array['whatsapp','email','in_app']::public.notification_channel[], 'A lab test was requested/ordered for the patient.'),
  ('lifestyle_checkin_due', 'education', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'Lifestyle programme daily check-in due.'),
  ('lifestyle_nudge', 'education', 'routine', 'patient', array['whatsapp','push']::public.notification_channel[], 'AI-personalised lifestyle coaching nudge.'),
  ('lifestyle_review_due', 'education', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'Lifestyle programme review due.'),
  ('medication_adherence_checkin', 'medication', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Medication adherence check-in (started/side effects/missed doses).'),
  ('medication_prescribed_patient', 'medication', 'important', 'patient', array['whatsapp','email','in_app']::public.notification_channel[], 'A new medication was prescribed.'),
  ('medication_refill_reminder', 'medication', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Medication refill due soon.'),
  ('medication_review_due', 'medication', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Scheduled medication review due.'),
  ('new_care_message', 'operational', 'important', 'patient_or_sponsor', array['whatsapp','in_app']::public.notification_channel[], 'New in-app care-team message.'),
  ('partner_license_expiry', 'administrative', 'urgent', 'admin', array['in_app']::public.notification_channel[], 'A partner facility''s regulatory license is expiring.'),
  ('pharmacy_order_patient_confirmation', 'medication', 'routine', 'patient', array['whatsapp','email','in_app']::public.notification_channel[], 'Pharmacy order payment confirmed.'),
  ('pharmacy_order_pharmacy_alert', 'medication', 'routine', 'partner_pharmacy', array['sms','email']::public.notification_channel[], 'A new paid pharmacy order needs preparing.'),
  ('preventive_review_due', 'clinical', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'Periodic preventive health review due.'),
  ('referral_patient_confirmation', 'referral', 'important', 'patient', array['whatsapp','email','in_app']::public.notification_channel[], 'Specialist referral payment confirmed.'),
  ('referral_specialist_alert', 'referral', 'important', 'partner_specialist', array['sms','email']::public.notification_channel[], 'A new confirmed referral needs an appointment arranged.'),
  ('region_now_available', 'operational', 'routine', 'patient_waitlisted', array['whatsapp','email','in_app']::public.notification_channel[], 'The platform is now live in the patient''s state.'),
  ('result_document_available', 'laboratory', 'important', 'patient', array['whatsapp']::public.notification_channel[], 'A new lab/ECG result document is available.'),
  ('result_interpretation_ready', 'clinical', 'urgent', 'patient', array['in_app']::public.notification_channel[], 'A doctor sent an interpretation of an uploaded result.'),
  ('reward_voucher_issued', 'administrative', 'routine', 'patient', array['in_app']::public.notification_channel[], 'A reward voucher was issued toward care.'),
  ('risk_signal_attention', 'clinical', 'urgent', 'patient', array['whatsapp','push']::public.notification_channel[], 'A risk-level transition (BP/CV-risk) needs attention.'),
  ('screening_due', 'clinical', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'A screening is due today.'),
  ('screening_escalated', 'clinical', 'urgent', 'patient', array['whatsapp','in_app','push']::public.notification_channel[], 'An overdue screening was escalated further.'),
  ('screening_overdue', 'clinical', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'A screening is now overdue.'),
  ('screening_upcoming', 'clinical', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'A screening is coming up soon.'),
  ('second_condition_needs_upgrade', 'clinical', 'important', 'patient', array['in_app']::public.notification_channel[], 'A second concurrent condition is now tracked; review needs a plan upgrade.'),
  ('sponsor_care_reviewed', 'operational', 'routine', 'sponsor', array['in_app','email','whatsapp','sms']::public.notification_channel[], 'A doctor reviewed something for the supported person.'),
  ('sponsor_monthly_report', 'administrative', 'routine', 'sponsor', array['in_app','email']::public.notification_channel[], 'Monthly spend/activity summary for a sponsor.'),
  ('sponsor_person_quiet', 'operational', 'routine', 'sponsor', array['in_app','email','whatsapp','sms']::public.notification_channel[], 'The supported person has not logged a reading recently.'),
  ('sponsor_spend_receipt', 'administrative', 'routine', 'sponsor', array['in_app','email']::public.notification_channel[], 'Receipt for funded care that was actually used.'),
  ('sponsored_plan_started', 'administrative', 'routine', 'sponsor_and_patient', array['in_app','email','whatsapp','sms']::public.notification_channel[], 'A sponsor started paying for the patient''s plan.'),
  ('vaccination_due', 'clinical', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'A vaccination dose is due.'),
  ('vaccination_escalated', 'clinical', 'urgent', 'patient', array['whatsapp','in_app','push']::public.notification_channel[], 'An overdue vaccination was escalated further.'),
  ('vaccination_overdue', 'clinical', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'A vaccination is now overdue.'),
  ('vaccination_upcoming', 'clinical', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'A vaccination is coming up soon.'),
  ('vaccination_verified', 'clinical', 'routine', 'patient', array['whatsapp','email']::public.notification_channel[], 'An uploaded vaccination certificate was verified by a clinician.'),
  ('video_consult_booked', 'referral', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'A video check-in slot was booked.'),
  ('video_visit_alternate_proposed', 'referral', 'important', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'The doctor offered alternate video-visit times.'),
  ('video_visit_declined', 'referral', 'important', 'patient', array['whatsapp']::public.notification_channel[], 'A paid video visit was declined/unconfirmed and refunded.'),
  ('vitals_red_flag_clinician_alert', 'clinical', 'critical', 'clinician', array['push','whatsapp','sms','in_app']::public.notification_channel[], 'RED/AMBER vitals red-flag (BP/SpO2/temperature) needs review.'),
  ('vitals_reminder', 'clinical', 'routine', 'patient', array['whatsapp']::public.notification_channel[], 'Time to log vitals.'),
  ('voucher_gift_used', 'administrative', 'routine', 'sponsor', array['in_app','email','whatsapp','sms']::public.notification_channel[], 'A gifted voucher was used by its beneficiary.'),
  ('wellness_challenge_ending', 'education', 'routine', 'patient', array['whatsapp','in_app']::public.notification_channel[], 'An active wellness challenge is ending, target not met.')
on conflict (key) do nothing;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.notification_templates;
  if v_count < 85 then
    raise exception 'notification_templates seed looks incomplete: only % rows', v_count;
  end if;
  raise notice 'PASS: notification_templates seeded with % rows', v_count;
end $$;
