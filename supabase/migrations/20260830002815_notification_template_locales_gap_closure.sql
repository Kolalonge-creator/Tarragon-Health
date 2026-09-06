-- Health Communication Engine — template-copy migration, gap closure.
--
-- A full sweep of every notification_templates registry key against BOTH
-- hardcoded copy sources (TEMPLATE_MAP in send-pending-notifications and
-- describe() in notification-bell.tsx) found 23 keys with literally no
-- implementation in EITHER place -- not documentation gaps like the pilot/
-- batch2/in_app migrations, but real, confirmed-live-enqueued notifications
-- that would render as "unknown template" (send-pending-notifications) or
-- generic "You have an update" (the in-app bell) whenever actually sent.
-- Confirmed via live query against every key: clinician_alert_sla_breach
-- had 96 real in_app rows already sitting there showing generic text; the
-- other 22 had zero rows so far (latent, not active) but are all wired to
-- a real trigger (grep-confirmed against non-seed migrations) that will
-- fire eventually -- the appointment engine's six keys especially, since
-- that feature shipped 2026-08-28 and is presumably about to see real
-- traffic. The companion code changes in this same commit close all 23:
--   - 13 needed a real TEMPLATE_MAP entry (whatsapp-eligible, so the DB
--     fallback structurally can't cover them -- same rule established by
--     the pilot migration): the Appointment Engine's six templates, the
--     escalating-preventive-reminders ladder's three overdue/escalated/
--     upcoming siblings for screening and three for vaccination, and
--     lifestyle_checkin_due.
--   - 16 needed a real describe() case (in_app is never TEMPLATE_MAP or
--     DB-fallback territory, full stop): care_access_revoked, the two
--     clinical-staff-lapse keys, clinician_alert_sla_breach,
--     data_breach_deadline, partner_license_expiry, all four
--     health_passport_* keys, and the six screening_*/vaccination_*
--     overdue-ladder keys' in_app leg.
--
-- Every row below for a key that ALSO got a TEMPLATE_MAP or describe()
-- case is catalog/documentation only, exactly like the prior three
-- migrations -- code remains the live renderer. TWO ROWS ARE DIFFERENT and
-- called out explicitly: health_passport_attested and health_passport_
-- revoked's email-channel rows are the ACTUAL, LIVE render source, because
-- those two keys deliberately got NO TEMPLATE_MAP entry -- their only
-- channels are in_app (needs describe(), added) and email (never
-- whatsapp, so the DB fallback the registry's own design doc describes
-- for a genuinely new template applies cleanly here, with no email-html/
-- text-conflation concern since this copy was never styled HTML to begin
-- with). This is the first migration in this PR where a row is not merely
-- documentation.
insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  -- Appointment Engine (catalog only -- TEMPLATE_MAP required, whatsapp-eligible)
  ('appointment_booking_confirmation', 'en', 'sms', null,
   'Your Tarragon Health {{appointment_type_label}} is booked for {{scheduled_for_formatted}}. Open the app for details. Tarragon Health'),
  ('appointment_cancelled', 'en', 'sms', null,
   -- Representative variant: cancelled_by_patient=true.
   'Your Tarragon Health appointment for {{scheduled_for_formatted}} has been cancelled, as requested. Book another any time in the app. Tarragon Health'),
  ('appointment_provider_cancelled', 'en', 'sms', null,
   -- Representative variant: reason present.
   'Your Tarragon Health {{appointment_type_label}} for {{scheduled_for_formatted}} has been cancelled by your provider ({{reason}}). Open the app to rebook. Tarragon Health'),
  ('appointment_reminder', 'en', 'sms', null,
   -- Representative variant: milestone <> 'shortly_before'.
   'Reminder: your Tarragon Health {{appointment_type_label}} is coming up ({{scheduled_for_formatted}}). Open the app for details. Tarragon Health'),
  ('appointment_rescheduled', 'en', 'sms', null,
   'Your Tarragon Health appointment has been rescheduled to {{scheduled_for_formatted}}. Open the app for details. Tarragon Health'),
  ('appointment_waiting_list_offer', 'en', 'sms', null,
   'A waiting-list slot opened up for {{scheduled_for_formatted}}. Claim it in the Tarragon Health app within {{offer_expires_minutes}} minutes or it goes to the next person. Tarragon Health'),

  -- Escalating preventive reminders (catalog only -- TEMPLATE_MAP required, whatsapp-eligible)
  ('screening_upcoming', 'en', 'sms', null,
   'Hi, your {{screen_type_name}} is coming up on {{due_date}}. Open the Tarragon Health app to book it. Tarragon Health'),
  ('screening_overdue', 'en', 'sms', null,
   'Hi, your {{screen_type_name}} was due {{due_date}} and is now overdue. Open the Tarragon Health app to book it. Tarragon Health'),
  ('screening_escalated', 'en', 'sms', null,
   'Hi, your {{screen_type_name}} has been overdue since {{due_date}}. Please book it soon, or your care team may follow up. Tarragon Health'),
  ('vaccination_upcoming', 'en', 'sms', null,
   'Hi, your {{vaccine_name}} is coming up on {{due_date}}. Open the Tarragon Health app to book or log it. Tarragon Health'),
  ('vaccination_overdue', 'en', 'sms', null,
   'Hi, your {{vaccine_name}} was due {{due_date}} and is now overdue. Open the Tarragon Health app to book or log it. Tarragon Health'),
  ('vaccination_escalated', 'en', 'sms', null,
   'Hi, your {{vaccine_name}} has been overdue since {{due_date}}. Please book or log it soon, or your care team may follow up. Tarragon Health'),
  ('lifestyle_checkin_due', 'en', 'sms', null,
   'Hi, time for today''s check-in on {{title}}. Open the Tarragon Health app to log it. Tarragon Health'),

  -- In-app-only / in-app-leg catalog rows (catalog only -- describe() required)
  ('care_access_revoked', 'en', 'in_app', null,
   -- Representative variant: by_owner=true.
   '{{owner_name}} revoked your care access'),
  ('clinical_staff_indemnity_lapse', 'en', 'in_app', null, '{{message}}'),
  ('clinical_staff_license_lapse', 'en', 'in_app', null, '{{message}}'),
  ('clinician_alert_sla_breach', 'en', 'in_app', null, '{{message}}'),
  ('data_breach_deadline', 'en', 'in_app', null, '{{message}}'),
  ('partner_license_expiry', 'en', 'in_app', null, '{{message}}'),
  ('health_passport_attestation_declined', 'en', 'in_app', null,
   -- Representative variant: reason present.
   'Your passport attestation request was declined: {{reason}}'),
  ('health_passport_attested', 'en', 'in_app', null,
   'Your health passport attestation is complete'),
  ('health_passport_revoked', 'en', 'in_app', null,
   -- Representative variant: reason present.
   'Your health passport credential ({{serial}}) was revoked: {{reason}}'),
  ('health_passport_verified', 'en', 'in_app', null,
   'Your vaccination certificate is verified (passport {{serial}})'),
  ('screening_upcoming', 'en', 'in_app', null, '{{screen_type_name}} is coming up soon'),
  ('screening_overdue', 'en', 'in_app', null, '{{screen_type_name}} is overdue'),
  ('screening_escalated', 'en', 'in_app', null, '{{screen_type_name}} is overdue: your care team may follow up'),
  ('vaccination_upcoming', 'en', 'in_app', null, '{{vaccine_name}} is coming up soon'),
  ('vaccination_overdue', 'en', 'in_app', null, '{{vaccine_name}} is overdue'),
  ('vaccination_escalated', 'en', 'in_app', null, '{{vaccine_name}} is overdue: your care team may follow up'),

  -- LIVE, FUNCTIONAL rows -- no TEMPLATE_MAP entry exists for these two
  -- keys (deliberately: never whatsapp, so the DB fallback is the correct,
  -- idiomatic path per the registry's own design comment). These ARE what
  -- renders the email leg once this migration is live, not documentation.
  ('health_passport_attested', 'en', 'email',
   'Your health passport attestation is complete',
   'Your health passport attestation is complete. Open the Tarragon Health app to see your passport.'),
  ('health_passport_revoked', 'en', 'email',
   'Your health passport credential was revoked',
   -- payload.reason can be null (nullif(trim(...), '') upstream) -- flat
   -- substitution renders it as an empty trailing sentence rather than
   -- omitting the clause entirely; an acceptable, documented limitation of
   -- this table's "no conditionals" design (see the registry migration's
   -- header), not a bug introduced here.
   'Your health passport credential {{serial}} was revoked. {{reason}}')
on conflict (template_key, locale, channel) do nothing;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notification_template_locales
  where (template_key, channel) in (
    ('appointment_booking_confirmation','sms'), ('appointment_cancelled','sms'),
    ('appointment_provider_cancelled','sms'), ('appointment_reminder','sms'),
    ('appointment_rescheduled','sms'), ('appointment_waiting_list_offer','sms'),
    ('screening_upcoming','sms'), ('screening_overdue','sms'), ('screening_escalated','sms'),
    ('vaccination_upcoming','sms'), ('vaccination_overdue','sms'), ('vaccination_escalated','sms'),
    ('lifestyle_checkin_due','sms'),
    ('care_access_revoked','in_app'), ('clinical_staff_indemnity_lapse','in_app'),
    ('clinical_staff_license_lapse','in_app'), ('clinician_alert_sla_breach','in_app'),
    ('data_breach_deadline','in_app'), ('partner_license_expiry','in_app'),
    ('health_passport_attestation_declined','in_app'), ('health_passport_attested','in_app'),
    ('health_passport_revoked','in_app'), ('health_passport_verified','in_app'),
    ('screening_upcoming','in_app'), ('screening_overdue','in_app'), ('screening_escalated','in_app'),
    ('vaccination_upcoming','in_app'), ('vaccination_overdue','in_app'), ('vaccination_escalated','in_app'),
    ('health_passport_attested','email'), ('health_passport_revoked','email')
  );
  if v_count < 31 then
    raise exception 'notification_template_locales gap-closure batch looks incomplete: only % rows', v_count;
  end if;
  raise notice 'PASS: notification_template_locales gap-closure batch seeded with % rows', v_count;
end $$;
