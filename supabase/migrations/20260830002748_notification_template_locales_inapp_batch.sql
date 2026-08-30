-- Health Communication Engine — template-copy migration, in-app batch.
--
-- Completes catalog coverage of the second (and last) hardcoded copy
-- source named in the original ask: apps/web/src/components/shell/
-- notification-bell.tsx's describe(), which renders every in_app-channel
-- notification client-side from raw payload -- a completely separate
-- mapping from TEMPLATE_MAP, never consulted by send-pending-notifications
-- (in_app rows are excluded from that function's own query). Same rules as
-- the two prior migrations, not repeated in full:
--   - Catalog/documentation only. describe() remains the sole live
--     renderer for in_app notifications; nothing in this table is wired to
--     it. There is no in_app "DB fallback" mechanism today -- only
--     send-pending-notifications' sms/email/push/voice fallback branch
--     reads this table at all.
--   - Real branching gets ONE representative variant, noted in a comment.
--   - Every row checked against the current describe() source via the same
--     substitution-diff method (see verify_inapp_batch.js in the PR).
--
-- 24 of these keys already have an sms/email/push row from the pilot or
-- batch-2 migrations -- notification-bell.tsx's in_app copy is its OWN,
-- independently-authored text, routinely shorter and sometimes genuinely
-- different in which fields it branches on (flagged case by case below).
-- The other 22 keys have no TEMPLATE_MAP entry at all: describe() is their
-- only implementation, matching their notification_templates.default_channels
-- of 'in_app' only.
--
-- Two divergences worth calling out explicitly, found while transcribing:
--   - medication_adherence_checkin: the in_app switch has a 'lab_review'
--     branch that the sms/TEMPLATE_MAP version does not have (TEMPLATE_MAP
--     only has started/side_effects/missed_doses + a generic default). The
--     channels have genuinely different branch sets, not just different
--     wording of the same branches.
--   - diabetes_complication_check_due: the in_app version shows the raw
--     payload.check_type value directly ("retinal"), while TEMPLATE_MAP's
--     sms version humanizes it ("eye screening"/"kidney check"). A patient
--     could see different wording for the same event depending on channel.
-- Neither is fixed here -- this migration documents current behaviour,
-- it does not change it.
insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('health_education_unlock', 'en', 'in_app', null,
   -- Representative variant: lesson_count=1 (singular). Plural: "N new
   -- lessons ready, starting with X".
   'New lesson ready: "{{lesson_title}}"'),
  ('new_care_message', 'en', 'in_app', null,
   -- Representative variant: author_role='care_team'. Other branches:
   -- 'sponsor' -> the sponsor's display name (or "someone who supports
   -- them"); anything else -> the patient's display name (or "the patient").
   'New message from the care team'),
  ('clinician_new_care_message', 'en', 'in_app', null,
   -- Representative variant: author_role <> 'sponsor' (the patient authored
   -- it). 'sponsor' branch: the sponsor's display name (or "a supporter").
   'New message from the patient'),
  ('clinician_new_referral', 'en', 'in_app', null,
   'New referral to triage: {{specialist_type}}'),
  ('clinician_care_plan_task', 'en', 'in_app', null,
   'Care plan task: {{reason}}'),
  ('health_reset_complete', 'en', 'in_app', null,
   'Your 90-Day Health Reset is complete: claim your free trial'),
  ('video_visit_alternate_proposed', 'en', 'in_app', null,
   'Your doctor offered a different time for your video visit: pick one'),
  ('care_access_view_request', 'en', 'in_app', null,
   '{{initiator_name}} sent a request to view care: respond in Your people'),
  ('care_access_manage_request', 'en', 'in_app', null,
   '{{initiator_name}} sent a request to manage care: respond in Your people'),
  ('care_access_request_accepted', 'en', 'in_app', null,
   '{{responder_name}} accepted your care access request'),
  ('care_access_request_declined', 'en', 'in_app', null,
   '{{responder_name}} declined your care access request'),
  ('medication_refill_reminder', 'en', 'in_app', null,
   'Refill reminder: {{drug_name}} is due soon'),
  ('medication_adherence_checkin', 'en', 'in_app', null,
   -- Representative variant: checkin_type='started'. See header note on the
   -- extra 'lab_review' branch this channel has that sms/TEMPLATE_MAP does
   -- not.
   'Have you started taking {{drug_name}}?'),
  ('voucher_gift_used', 'en', 'in_app', null,
   '{{beneficiary_name}} used {{label}} that you bought for them'),
  ('care_voucher_expiring', 'en', 'in_app', null,
   '{{label}} runs out on {{expires_on}}. Use it, or ask us and we will extend it.'),
  ('reward_voucher_issued', 'en', 'in_app', null,
   -- Representative variant: value_naira present. Absent: "{{label}} added
   -- to your account" (no amount clause).
   '{{label}}: a ₦{{value_naira}} voucher toward your care'),
  ('sponsor_monthly_report', 'en', 'in_app', null,
   -- Genuinely different content from the sms/email rows for this key
   -- (which use a pre-computed `headline` sentence): this reads ready/used
   -- counts directly.
   'Monthly summary for {{beneficiary_name}}: {{used_this_month}} used this month, {{ready_count}} still waiting'),
  ('sponsor_care_reviewed', 'en', 'in_app', null,
   'A doctor has reviewed something for {{person_name}}'),
  ('sponsor_person_quiet', 'en', 'in_app', null,
   '{{person_name}} hasn''t logged a reading in {{quiet_days}} days; a call might help'),
  ('sponsored_plan_started', 'en', 'in_app', null,
   -- Representative variant: is_payer=true, same as this key's sms row.
   'You are now paying for {{person_name}}''s {{plan_name}}'),
  ('care_message_safety_flag', 'en', 'in_app', null,
   'Priority 1: a care message may describe an emergency, needs review now'),
  ('critical_notification_escalation_exhausted', 'en', 'in_app', null,
   'A critical alert went unconfirmed on every channel: needs a look'),
  ('result_interpretation_ready', 'en', 'in_app', null,
   'A doctor sent you an interpretation of a lab result you uploaded'),
  ('free_tier_reading_self_care_suggestion', 'en', 'in_app', null,
   '{{vital_label}}: {{self_care_note}}'),
  ('lab_order_patient_confirmation', 'en', 'in_app', null,
   'Your order for {{test_name}} at {{lab_name}} is confirmed'),
  ('lab_order_requested_patient', 'en', 'in_app', null,
   -- Representative variant: self_booked=true, same as this key's sms row.
   '{{test_name}} is ready: take it to your chosen lab'),
  ('medication_prescribed_patient', 'en', 'in_app', null,
   '{{drug_name}} was prescribed for you'),
  ('pharmacy_order_patient_confirmation', 'en', 'in_app', null,
   'Your pharmacy order is confirmed: {{items_summary}}'),
  ('referral_patient_confirmation', 'en', 'in_app', null,
   'Your referral to {{specialist_name}} is confirmed'),
  ('result_document_available', 'en', 'in_app', null,
   'A new lab result document is available'),
  ('emergency_followup', 'en', 'in_app', null,
   'Checking in after your recent emergency alert. How are you doing?'),
  ('region_now_available', 'en', 'in_app', null,
   '{{display_name}} is now available in your area'),
  ('annual_review_due', 'en', 'in_app', null,
   'Your Annual Health Review is due'),
  ('booking_reminder', 'en', 'in_app', null,
   -- Representative variant: days_before > 0. When absent/zero: "{{service_
   -- type}} is coming up" with no day count.
   '{{service_type}} is coming up in {{days_before}} days'),
  ('care_outreach_checkin', 'en', 'in_app', null,
   'Your care team wants to check in with you'),
  ('diabetes_complication_check_due', 'en', 'in_app', null,
   -- See header note: this shows the RAW check_type value, unlike the sms
   -- row's humanized label.
   'Your {{check_type}} check is due'),
  ('health_check_due_soon', 'en', 'in_app', null,
   '{{bundle_name}} is due again soon'),
  ('health_check_rebook_due', 'en', 'in_app', null,
   'Time to rebook {{bundle_name}}'),
  ('lifestyle_review_due', 'en', 'in_app', null,
   'Your lifestyle review is due'),
  ('medication_review_due', 'en', 'in_app', null,
   'Your medication review is due'),
  ('preventive_review_due', 'en', 'in_app', null,
   'Your preventive review is due'),
  ('screening_due', 'en', 'in_app', null,
   '{{screen_type_name}} is due'),
  ('vaccination_due', 'en', 'in_app', null,
   '{{vaccine_name}} is due'),
  ('vitals_reminder', 'en', 'in_app', null,
   'Time to log your vitals'),
  ('wellness_challenge_ending', 'en', 'in_app', null,
   '{{challenge_title}} ends soon, keep going'),
  ('second_condition_needs_upgrade', 'en', 'in_app', null,
   'We''re now tracking {{condition}} for you too. Complete Care adds a scheduled review for it')
on conflict (template_key, locale, channel) do nothing;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notification_template_locales
  where channel = 'in_app'
    and template_key in (
      'health_education_unlock','new_care_message','clinician_new_care_message','clinician_new_referral',
      'clinician_care_plan_task','health_reset_complete','video_visit_alternate_proposed',
      'care_access_view_request','care_access_manage_request','care_access_request_accepted',
      'care_access_request_declined','medication_refill_reminder','medication_adherence_checkin',
      'voucher_gift_used','care_voucher_expiring','reward_voucher_issued','sponsor_monthly_report',
      'sponsor_care_reviewed','sponsor_person_quiet','sponsored_plan_started','care_message_safety_flag',
      'critical_notification_escalation_exhausted','result_interpretation_ready',
      'free_tier_reading_self_care_suggestion','lab_order_patient_confirmation','lab_order_requested_patient',
      'medication_prescribed_patient','pharmacy_order_patient_confirmation','referral_patient_confirmation',
      'result_document_available','emergency_followup','region_now_available','annual_review_due',
      'booking_reminder','care_outreach_checkin','diabetes_complication_check_due','health_check_due_soon',
      'health_check_rebook_due','lifestyle_review_due','medication_review_due','preventive_review_due',
      'screening_due','vaccination_due','vitals_reminder','wellness_challenge_ending',
      'second_condition_needs_upgrade'
    );
  if v_count < 46 then
    raise exception 'notification_template_locales in_app batch looks incomplete: only % rows', v_count;
  end if;
  raise notice 'PASS: notification_template_locales in_app batch seeded with % rows', v_count;
end $$;
