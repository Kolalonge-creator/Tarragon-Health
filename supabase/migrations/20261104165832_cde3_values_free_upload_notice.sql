-- Clinical document engine: when the care team uploads a report into a patient's record, the patient is told a report has been
-- added, without anything from it (decision CDE-08, founder and CMO, 2026-11-04; answers OQ-CDE-08).
--
-- WHY THIS IS SAFE UNDER S27 INV-03: INV-03 exists so a patient never sees an unreviewed result someone else supplied. That still
-- holds: the result stays held for a clinician, and this notice carries no test name, value, flag, laboratory or finding (INV-07
-- neutral wording, like lab_result_corrected). It says only that a report was added and that the care team will review it. The
-- existing release notice (lab_result_ready) still tells the patient when the result can be seen.
--
-- WHEN: the intake record is opened for an upload made by the care team (care coordinator, legacy lab liaison, clinician, admin).
-- Not for the patient's own upload (they know) or a laboratory's own portal submission (the release notice covers it).
-- In-app and push only (no email or SMS: the notification content_class rules, and SMS is phone verification only).

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('lab_report_received', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate',
   'The care team added a report to your record; it will be reviewed. Names no test, value, flag, laboratory or finding (CDE-08, INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('lab_report_received', 'en', 'in_app', 'A report was added to your record',
   'Your care team has added a report to your health record. A doctor will review it, and we will let you know when you can see it.'),
  ('lab_report_received', 'en', 'push', 'A report was added to your record', 'Open the app for details.')
on conflict (template_key, locale, channel) do nothing;

-- private.cde_open_intake from 20261104160432, with the notice added after the intake row is opened.
create or replace function private.cde_open_intake(
  p_org uuid, p_patient uuid, p_channel text, p_uploaded_by uuid, p_sha text, p_mime text,
  p_routed_table text, p_routed_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing uuid;
  v_cd uuid;
begin
  if p_sha is not null then
    select id into v_existing from public.clinical_documents
     where patient_id = p_patient and content_sha256 = p_sha and not is_superseded
     limit 1;
    if v_existing is not null then
      raise exception 'clinical_document_duplicate'
        using errcode = '23505',
              detail = 'This file is already in this patient''s record.',
              hint = v_existing::text;
    end if;
  end if;

  insert into public.clinical_documents (organisation_id, patient_id, upload_channel, uploaded_by, kind_code, kind_source,
      access_category, status, content_sha256, mime_type, routed_table, routed_id, is_test)
  values (p_org, p_patient, p_channel, p_uploaded_by, 'lab', 'pipeline', 'labs_results', 'uploaded', p_sha, p_mime,
      p_routed_table, p_routed_id, coalesce((select is_test from public.profiles where id = p_patient), false))
  returning id into v_cd;

  perform private.cde_refresh(p_routed_table, p_routed_id);

  -- CDE-08: a values-free notice for a report the care team added. The payload is the intake id only; the wording is fixed.
  if p_channel in ('care_coordinator', 'lab_liaison', 'clinician', 'admin') then
    perform private.lab_notify(p_patient, p_org, 'lab_report_received', jsonb_build_object('clinical_document_id', v_cd));
  end if;
end;
$function$;

revoke all on function private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid) from public;
revoke all on function private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid) from authenticated;

do $$
begin
  if not exists (select 1 from public.notification_template_locales where template_key = 'lab_report_received' and channel = 'in_app') then
    raise exception 'lab_report_received in-app wording missing';
  end if;
  if has_function_privilege('authenticated', 'private.cde_open_intake(uuid,uuid,text,uuid,text,text,text,uuid)', 'EXECUTE') then
    raise exception 'cde_open_intake must not be executable by a client';
  end if;
end $$;
