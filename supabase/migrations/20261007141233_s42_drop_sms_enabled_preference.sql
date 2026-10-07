-- S42 (v5 Module 1, function 1.16, INV-08, OQ-32): remove patient_notification_preferences.sms_enabled.
-- Not applied to production by this session.
--
-- SMS is for phone verification codes (and clinician paging, D-12) only; a patient has no SMS preference to keep. The column
-- was a promise the platform does not make. whatsapp_enabled was dropped by S01c.
--
-- ORDER (CLAUDE.md: ship the code first, the schema second). The deployed send-pending-notifications edge function and both
-- apps select or write sms_enabled; this branch's code no longer does. Apply this migration only AFTER the new edge function
-- is deployed and the web and mobile builds that stop writing the column are live. Applying it earlier makes the OLD function's
-- preference lookup fail as a whole (the failure mode S01c found with the old column list).
--
-- Counted first: the column holds whatever the patient last saved; since S13 no screen shows it, so nothing a person chose is lost.
-- No function or view reads it (checked against pg_proc and pg_views on a replayed database).

alter table public.patient_notification_preferences drop column sms_enabled;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patient_notification_preferences'
              and column_name in ('sms_enabled', 'whatsapp_enabled')) then
    raise exception 'S42: an SMS or WhatsApp preference column is still there';
  end if;
end $$;
