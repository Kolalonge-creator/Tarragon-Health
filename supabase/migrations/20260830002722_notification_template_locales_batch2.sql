-- Health Communication Engine — template-copy migration, batch 2.
--
-- Continues 20260829000158_notification_template_locales_pilot_batch.sql:
-- transcribes the remaining pre-existing TEMPLATE_MAP-backed keys (the
-- pilot's 10 plus these 35 covers all 45 keys that had a TEMPLATE_MAP
-- entry before this PR's ack-timeout fix). Same rules as the pilot
-- migration's header comment, not repeated in full here:
--   - Every row is catalog/documentation only. TEMPLATE_MAP remains the
--     sole live render source for every key in this file — nothing here
--     is wired to actually render a send, for the same two structural
--     reasons (whatsapp exclusion, email html/text conflation) explained
--     in the pilot migration.
--   - Where TEMPLATE_MAP has real branching (a ternary/switch/computed
--     value beyond a simple `?? default`), this file documents ONE
--     representative variant, called out in a comment beside the row —
--     never every possible rendering.
--   - Each row was checked against the current TEMPLATE_MAP source with
--     the same substitution-diff method as the pilot batch (see
--     verify_templates_batch2.js in the PR).
--
-- Two exceptions worth flagging explicitly:
--   - lab_order_lab_alert and referral_specialist_alert: their SMS leg
--     (unlike their email leg) has NO branching and IS channel-safe
--     (sms+email only, confirmed via their enqueue triggers, never
--     whatsapp) — same category as pharmacy_order_pharmacy_alert in the
--     pilot batch. These would be the next real cutover candidates if the
--     email text/html schema gap is ever closed; the SMS row here is
--     already byte-identical-verified, not just representative.
--   - sponsor_monthly_report and broadcast_announcement generate their
--     body from a loop over payload.people / from fully admin-authored
--     free text respectively — there is no single fixed "copy" to
--     transcribe. Their rows below capture only the fixed wrapper
--     sentence (headline / subject+body passthrough); the real per-row
--     table and HTML escaping stay TEMPLATE_MAP-only, permanently, by
--     necessity, not choice.
insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('lifestyle_nudge', 'en', 'sms', null,
   '{{message}} Tarragon Health'),
  ('medication_refill_reminder', 'en', 'sms', null,
   'Hi, your {{drug_name}} refill is due {{refill_date}}. Sort it here: https://app.tarragonhealth.ng/patient/medications Tarragon Health'),
  ('booking_reminder', 'en', 'sms', null,
   -- Representative variant: days_before <> '1' ("days" plural). TEMPLATE_MAP
   -- singularizes to "day" only when days_before is exactly the string "1".
   'Hi, reminder: your {{service_type}} request at {{facility_name}} is for {{requested_date}} ({{days_before}} days from now). Reply on WhatsApp or open the app. Tarragon Health'),
  ('medication_adherence_checkin', 'en', 'sms', null,
   -- Representative variant: checkin_type='started'. Other branches:
   -- 'side_effects' -> "Any side effects from X?"; 'missed_doses' -> "How
   -- many doses of X have you missed?"; anything else -> "Time for a quick
   -- review of X."
   'Have you started {{drug_name}}? Answer here: https://app.tarragonhealth.ng/patient/medications Tarragon Health'),
  ('vaccination_due', 'en', 'sms', null,
   'Hi, your {{vaccine_name}} is due {{due_date}}. Open the Tarragon Health app to book or log it. Tarragon Health'),
  ('screening_due', 'en', 'sms', null,
   'Hi, your {{screen_type_name}} is due {{due_date}}. Open the Tarragon Health app to book it. Tarragon Health'),
  ('health_check_due_soon', 'en', 'sms', null,
   'Hi, your {{bundle_name}} is due {{due_date}}, about a month from now. Open the Tarragon Health app to book it in good time. Tarragon Health'),
  ('risk_signal_attention', 'en', 'sms', null,
   'Hi, {{signal_label}} {{reason}}. Your care team is aware; open the Tarragon Health app to see more. Tarragon Health'),
  ('preventive_review_due', 'en', 'sms', null,
   'Hi, your preventive health review is due {{due_date}}. Your care team will be in touch; open the app to see details. Tarragon Health'),
  ('annual_review_due', 'en', 'sms', null,
   'Hi, your {{cycle_year}} Annual Health Review has started. Your care team will guide you through it; open the app to see what''s next. Tarragon Health'),
  ('annual_review_consult_scheduled', 'en', 'sms', null,
   -- TEMPLATE_MAP formats the raw payload.scheduled_at via
   -- toLocaleString('en-NG', {timeZone:'Africa/Lagos'}); flat token
   -- substitution can't reproduce that, so this documents the shape with a
   -- pre-formatted representative value.
   'Your Annual Health Review video consult is confirmed for {{scheduled_at_formatted}}. The join link is in the Tarragon Health app. Tarragon Health'),
  ('wellness_challenge_ending', 'en', 'sms', null,
   'Hi, your "{{challenge_title}}" challenge ends in 24 hours and you''re at {{progress}}/{{target}}. Finish it in the Tarragon Health app. Tarragon Health'),
  ('care_outreach_checkin', 'en', 'sms', null,
   'Hi, your recent health record suggests a quick check-in would help. Open the Tarragon Health app to see what''s due; booking takes a minute. Tarragon Health'),
  ('async_consult_answered', 'en', 'sms', null,
   'A doctor has answered your question. Open the Tarragon Health app to read it. Tarragon Health'),
  ('video_consult_booked', 'en', 'sms', null,
   -- Same Africa/Lagos date-formatting branch as annual_review_consult_scheduled.
   'Your video check-in with your Tarragon doctor is booked for {{scheduled_at_formatted}}. The join link is in the app. Tarragon Health'),
  ('video_visit_alternate_proposed', 'en', 'sms', null,
   'Your doctor offered different times for your video visit. Pick one in the app within 24 hours, or you''ll be refunded in full. Tarragon Health'),
  ('broadcast_announcement', 'en', 'sms', null,
   -- Fully admin-authored free text; there is no fixed "copy" beyond this
   -- wrapper. Real email additionally HTML-escapes and brand-wraps the body.
   '{{subject}}: {{body}} Tarragon Health'),
  ('broadcast_announcement', 'en', 'email', '{{subject}}', '{{body}}'),
  ('pharmacy_order_patient_confirmation', 'en', 'sms', null,
   'Hi {{patient_name}}, your Tarragon Health order {{order_number}} ({{items_summary}}) is confirmed. Show order {{order_number}} and your patient ID {{patient_number}} at {{pharmacy_name}} to collect. Tarragon Health'),
  ('pharmacy_order_patient_confirmation', 'en', 'email',
   'Your Tarragon Health order {{order_number}} is confirmed',
   'Hi {{patient_name}}, your Tarragon Health order {{order_number}} ({{items_summary}}) is confirmed. Show order {{order_number}} and your patient ID {{patient_number}} at {{pharmacy_name}} to collect. Tarragon Health'),
  ('sponsor_care_reviewed', 'en', 'sms', null,
   'Tarragon Health: a doctor has reviewed something for {{person_name}}. They will discuss what was found with {{person_name}} directly.'),
  ('sponsor_care_reviewed', 'en', 'email', 'A doctor has reviewed something for {{person_name}}',
   'A doctor on {{person_name}}''s care team has reviewed something flagged on their record. We tell you that a review happened, not what was found.'),
  ('sponsor_person_quiet', 'en', 'sms', null,
   'Tarragon Health: {{person_name}} has not logged a reading in {{quiet_days}} days. A call from you often does more than a reminder from us.'),
  ('sponsor_person_quiet', 'en', 'email', '{{person_name}} has been quiet for {{quiet_days}} days',
   '{{person_name}} is on a care plan that works best with regular readings, and has not logged one in {{quiet_days}} days.'),
  ('sponsor_spend_receipt', 'en', 'sms', null,
   -- Representative variant: spent_on present. amount/balance are
   -- pre-formatted (toLocaleString) figures in the real payload -- this
   -- documents the shape assuming an already-formatted string.
   'Tarragon Health: ₦{{amount}} you funded paid for {{what}} for {{beneficiary}} on {{spent_on}}. Remaining balance ₦{{balance}}.'),
  ('sponsor_spend_receipt', 'en', 'email', 'Your ₦{{amount}} paid for {{what}} for {{beneficiary}}',
   'Care you paid for {{beneficiary}} has been used: ₦{{amount}} for {{what}}. Balance left: ₦{{balance}}.'),
  ('sponsor_monthly_report', 'en', 'sms', null,
   -- headline is a pre-computed sentence ("₦X became care last month"); the
   -- real per-person breakdown is a generated HTML table (map/reduce over
   -- payload.people) with no single fixed template -- not represented here.
   'Tarragon Health: {{headline}}. See People you support in your dashboard.'),
  ('sponsor_monthly_report', 'en', 'email', 'Your monthly summary: {{headline}}',
   'Here is what happened last month with the care you are paying for: {{headline}}.'),
  ('lab_order_patient_confirmation', 'en', 'sms', null,
   'Hi {{patient_name}}, your Tarragon Health order {{order_number}} ({{test_name}}) is confirmed at {{lab_name}}. Show order {{order_number}} and your patient ID {{patient_number}} when you arrive. Tarragon Health'),
  ('lab_order_patient_confirmation', 'en', 'email',
   'Your Tarragon Health order {{order_number}} is confirmed',
   'Hi {{patient_name}}, your Tarragon Health order {{order_number}} ({{test_name}}) is confirmed at {{lab_name}}. Show order {{order_number}} and your patient ID {{patient_number}} when you arrive. Tarragon Health'),
  -- Channel-safe (sms+email only, never whatsapp -- confirmed via
  -- enqueue_lab_order_facility triggers). This SMS row has no branching in
  -- TEMPLATE_MAP and is byte-identical-verified, not just representative.
  ('lab_order_lab_alert', 'en', 'sms', null,
   'New Tarragon Health order {{order_number}}: {{patient_name}} (patient ID {{patient_number}}): {{test_name}}. Please prepare to receive this patient. Tarragon Health'),
  ('lab_order_lab_alert', 'en', 'email', 'New Tarragon Health order {{order_number}}: {{patient_name}}',
   -- Real HTML has a facility_name branch ("at X" when present) not
   -- reproduced here; this documents the facility_name-absent variant.
   'A patient has a confirmed, paid booking. Please prepare for: order {{order_number}}, patient {{patient_name}} (ID {{patient_number}}), test {{test_name}}.'),
  ('referral_patient_confirmation', 'en', 'sms', null,
   'Hi {{patient_name}}, your Tarragon Health referral {{referral_number}} to {{specialist_name}} is confirmed. Your care team will follow up on booking your appointment. Tarragon Health'),
  ('referral_patient_confirmation', 'en', 'email',
   'Your Tarragon Health referral {{referral_number}} is confirmed',
   'Hi {{patient_name}}, your Tarragon Health referral {{referral_number}} to {{specialist_name}} is confirmed. Your care team will follow up on booking your appointment. Tarragon Health'),
  -- Channel-safe (sms+email only, never whatsapp -- confirmed via
  -- enqueue_referral_facility triggers). This SMS row has no branching in
  -- TEMPLATE_MAP and is byte-identical-verified, not just representative.
  ('referral_specialist_alert', 'en', 'sms', null,
   'New Tarragon Health referral {{referral_number}}: {{patient_name}} (patient ID {{patient_number}}): {{specialist_type}}. Please expect contact to arrange this patient''s appointment. Tarragon Health'),
  ('referral_specialist_alert', 'en', 'email', 'New Tarragon Health referral {{referral_number}}: {{patient_name}}',
   -- Real HTML has an optional referral_reason row not reproduced here;
   -- this documents the referral_reason-absent variant.
   'A patient has a confirmed referral to your practice: {{referral_number}}, patient {{patient_name}} (ID {{patient_number}}), type {{specialist_type}}.'),
  ('region_now_available', 'en', 'sms', null,
   -- Representative variant: no care_recipient (not booking on behalf of a
   -- family member). services_pretty is a pre-resolved, mapped/joined
   -- string (e.g. "lab tests, pharmacy orders").
   'Good news {{requester_name}}, TarragonHealth is now live in {{state}}. You can now book {{services_pretty}} in the app. Tarragon Health'),
  ('region_now_available', 'en', 'email', 'TarragonHealth is now live in {{state}}',
   'Great news, TarragonHealth is now live in {{state}}. The services you asked us to tell you about are ready to book: {{services_pretty}}.'),
  ('medication_prescribed_patient', 'en', 'sms', null,
   -- Representative variant: payload.details supplied directly (real code
   -- falls back to composing drug_name+dose+frequency when details is blank).
   'Hi {{patient_name}}, a new medication has been added to your care plan: {{details}}. See the full details in the Tarragon Health app. Tarragon Health'),
  ('medication_prescribed_patient', 'en', 'email', 'A new medication has been added to your care plan',
   'Hi {{patient_name}}, a new medication has been added to your care plan: {{details}}. Open the app for the full details.'),
  ('lab_order_requested_patient', 'en', 'sms', null,
   -- Representative variant: self_booked=true. Non-self-booked wording:
   -- "a lab test has been requested for you" without the "show order"
   -- instruction.
   'Hi {{patient_name}}, your lab order is confirmed: {{test_name}} (order {{order_number}}). Show order {{order_number}} at the lab to have it done. Tarragon Health'),
  ('lab_order_requested_patient', 'en', 'email', 'Your lab test order {{order_number}} is confirmed',
   'Your lab test order is confirmed. Show order {{order_number}} at the lab so they know exactly what to run: {{test_name}}.'),
  ('vaccination_verified', 'en', 'sms', null,
   -- Representative variant: no next_dose_date.
   'Hi {{patient_name}}, your {{vaccine_name}} has been verified by your Tarragon care team (certificate {{certificate_serial}}). Download it in the app. Tarragon Health'),
  ('vaccination_verified', 'en', 'email', 'Your {{vaccine_name}} is verified: Tarragon certificate {{certificate_serial}}',
   'Your Tarragon care team has reviewed the certificate you uploaded and confirmed your {{vaccine_name}} dose. Certificate: {{certificate_serial}}.'),
  ('emergency_contact_alert', 'en', 'sms', null,
   '{{contact_name}}, this is an urgent alert from Tarragon Health. {{patient_name}} reported a possible medical emergency and may need your help. Please try to reach them now. If you cannot and it is an emergency, help them get to the nearest hospital. Tarragon Health'),
  ('abnormal_result_clinician_alert', 'en', 'sms', null,
   'New Priority 1 alert: {{patient_name}}''s screening result needs review ({{condition_label}}). See your Tarragon Health worklist. Tarragon Health'),
  ('emergency_event_clinician_alert', 'en', 'sms', null,
   'New Priority 1 alert: {{patient_name}}''s case needs review ({{source_label}}). See your Tarragon Health worklist. Tarragon Health'),
  ('vitals_red_flag_clinician_alert', 'en', 'sms', null,
   '{{level_label}}: {{patient_name}}''s {{vital_label}} needs review. See your Tarragon Health worklist. Tarragon Health'),
  ('emergency_followup', 'en', 'sms', null,
   'Hi {{patient_name}}, we noticed you recently reported an emergency. We hope you''re okay. When you can, open the Tarragon Health app to let your care team know how you''re doing. Tarragon Health')
on conflict (template_key, locale, channel) do nothing;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notification_template_locales
  where template_key in (
    'lifestyle_nudge','medication_refill_reminder','booking_reminder','medication_adherence_checkin',
    'vaccination_due','screening_due','health_check_due_soon','risk_signal_attention',
    'preventive_review_due','annual_review_due','annual_review_consult_scheduled',
    'wellness_challenge_ending','care_outreach_checkin','async_consult_answered','video_consult_booked',
    'video_visit_alternate_proposed','broadcast_announcement','pharmacy_order_patient_confirmation',
    'sponsor_care_reviewed','sponsor_person_quiet','sponsor_spend_receipt','sponsor_monthly_report',
    'lab_order_patient_confirmation','lab_order_lab_alert','referral_patient_confirmation',
    'referral_specialist_alert','region_now_available','medication_prescribed_patient',
    'lab_order_requested_patient','vaccination_verified','emergency_contact_alert',
    'abnormal_result_clinician_alert','emergency_event_clinician_alert','vitals_red_flag_clinician_alert',
    'emergency_followup'
  );
  if v_count < 45 then
    raise exception 'notification_template_locales batch 2 looks incomplete: only % rows', v_count;
  end if;
  raise notice 'PASS: notification_template_locales batch 2 seeded with % rows', v_count;
end $$;
