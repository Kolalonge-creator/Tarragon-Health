-- Clinical document engine, step 5a: ECG and imaging uploads through the intake record, and "Not sure" uploads routed to them.
--
-- Design: docs/plans/clinical-document-engine-2026-11-04.md §3.2, §11 step 5, §17 (step 5a as built).
--
--   1. Every ECG and imaging report document gets an intake record, opened by a trigger as the lab stores already do: one status
--      list, the file fingerprint and the duplicate refusal across every store. Their own handlers are unchanged (every upload
--      opens a clinician review alert on every plan; a care-team upload tells the patient); the intake mirrors them.
--   2. imaging_report_documents and imaging_reports gain access_category (default labs_results, as today). A pelvic, obstetric or
--      breast-adjacent scan sorted through the intake keeps the protective category of its kind, so break-glass never opens a
--      reproductive_health scan; a filed report inherits its document's category. Policies rewritten to read the column.
--   3. A "Not sure" upload sorted as an ECG or an imaging kind (including mammography) is routed: the server copies the file into
--      that reader's bucket and calls public.route_clinical_document (service role only), which inserts the ECG or imaging row;
--      the intake row is adopted. Pathology, cervical and narrative kinds stay on the step 4 review section.
--
-- Gates (G-01): none added. AI-006 (ECG, live) and AI-016 (imaging, off) keep their own switches.
-- Live counts before this migration (2026-11-04): ecg_report_documents 0, imaging_report_documents 0, imaging_reports 0.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Fingerprints and the imaging access category
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.ecg_report_documents add column content_sha256 text
  constraint ecg_report_documents_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$');
alter table public.imaging_report_documents add column content_sha256 text
  constraint imaging_report_documents_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$');
alter table public.imaging_report_documents
  add column access_category public.care_access_category not null default 'labs_results';
alter table public.imaging_reports
  add column access_category public.care_access_category not null default 'labs_results';

-- A filed report is read under its document's category (a filed pelvic scan stays reproductive_health).
create or replace function private.imaging_report_inherit_access_category()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.document_id is not null then
    select d.access_category into new.access_category from public.imaging_report_documents d where d.id = new.document_id;
    new.access_category := coalesce(new.access_category, 'labs_results');
  end if;
  return new;
end;
$function$;
revoke all on function private.imaging_report_inherit_access_category() from public, anon, authenticated;
create trigger imaging_reports_inherit_access_category before insert or update of document_id on public.imaging_reports
  for each row execute function private.imaging_report_inherit_access_category();

drop policy imaging_report_documents_select on public.imaging_report_documents;
drop policy imaging_report_documents_insert on public.imaging_report_documents;
drop policy imaging_report_documents_update on public.imaging_report_documents;
create policy imaging_report_documents_select on public.imaging_report_documents for select to authenticated
  using (patient_id = (select auth.uid()) or private.staff_may_read(patient_id, organisation_id, access_category));
create policy imaging_report_documents_insert on public.imaging_report_documents for insert to authenticated
  with check ((patient_id = (select auth.uid()) and source = 'patient'::public.imaging_report_document_source)
              or private.staff_may_write(patient_id, organisation_id, access_category));
create policy imaging_report_documents_update on public.imaging_report_documents for update to authenticated
  using (private.staff_may_write(patient_id, organisation_id, access_category))
  with check (private.staff_may_write(patient_id, organisation_id, access_category));

drop policy imaging_reports_select on public.imaging_reports;
drop policy imaging_reports_insert on public.imaging_reports;
drop policy imaging_reports_update on public.imaging_reports;
create policy imaging_reports_select on public.imaging_reports for select to authenticated
  using (patient_id = (select auth.uid()) or private.staff_may_read(patient_id, organisation_id, access_category));
create policy imaging_reports_insert on public.imaging_reports for insert to authenticated
  with check (private.staff_may_write(patient_id, organisation_id, access_category));
create policy imaging_reports_update on public.imaging_reports for update to authenticated
  using (private.staff_may_write(patient_id, organisation_id, access_category))
  with check (private.staff_may_write(patient_id, organisation_id, access_category));

-- The category is set by the server (sorting) or inherited, never moved by a later edit.
create or replace function private.guard_imaging_access_category()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.access_category is distinct from old.access_category and current_user in ('authenticated', 'anon') then
    raise exception 'the access category of an imaging record cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$function$;
create trigger imaging_report_documents_access_category_guard before update of access_category on public.imaging_report_documents
  for each row execute function private.guard_imaging_access_category();
create trigger imaging_reports_access_category_guard before update of access_category on public.imaging_reports
  for each row execute function private.guard_imaging_access_category();

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Intake records for ECG and imaging documents
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.clinical_documents drop constraint clinical_documents_routed_table_check;
alter table public.clinical_documents add constraint clinical_documents_routed_table_check check (routed_table in
  ('lab_result_documents', 'lab_result_files', 'ecg_report_documents', 'imaging_report_documents'));

-- Redefined from 20261104184341: ECG and imaging branches added.
create or replace function private.cde_refresh(p_routed_table text, p_routed_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cd public.clinical_documents;
  v_status text;
  v_reason text;
  v_visible boolean := false;
  d public.lab_result_documents;
  e public.lab_report_extractions;
  r public.lab_results;
  v_reviewed_at timestamptz;
  v_alert uuid;
  v_unready boolean;
  v_superseded boolean := false;
begin
  select * into v_cd from public.clinical_documents where routed_table = p_routed_table and routed_id = p_routed_id;
  if not found then return; end if;

  if p_routed_table = 'lab_result_documents' then
    select * into d from public.lab_result_documents where id = p_routed_id;
    if not found then return; end if;
    select * into e from public.lab_report_extractions where document_id = p_routed_id;
    v_superseded := d.superseded_by_document_id is not null;
    -- Mirrors lab_result_documents_select + lab_result_documents_hide_replaced exactly.
    v_visible := (d.source = 'patient' or d.reviewed_at is not null)
                 and (d.superseded_by_document_id is null or d.reviewed_at is not null);
    if d.superseded_by_document_id is not null and d.reviewed_at is null then
      v_status := 'superseded'; v_reason := 'Replaced by a newer upload';
    elsif d.reviewed_at is not null or e.status = 'confirmed' then
      v_status := 'reviewed';
    elsif e.status = 'failed' then
      v_status := 'processing_failed'; v_reason := left(coalesce(e.error_message, 'The automatic reader failed'), 300);
    elsif e.id is null then
      -- Not read yet. A patient's own PDF or photo is read automatically straight after upload; anything else waits for a person.
      if d.source = 'patient' and coalesce(d.mime_type, '') in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic') then
        v_status := 'processing';
      elsif d.clinician_alert_id is not null then
        v_status := 'doctor_review_required';
      else
        v_status := 'awaiting_verification';
      end if;
    else
      -- extracted or discarded: a draft exists (or was thrown away) and no clinician has filed it yet.
      select exists (
        select 1 from jsonb_array_elements(coalesce(e.rows, '[]'::jsonb)) x
        where coalesce(x ->> 'status', '') <> 'ready' or coalesce(x ->> 'confidence', 'low') = 'low'
      ) or jsonb_array_length(coalesce(e.rows, '[]'::jsonb)) = 0 or e.status = 'discarded'
      into v_unready;
      if d.clinician_alert_id is not null then
        v_status := 'doctor_review_required';
      elsif v_unready then
        v_status := 'awaiting_verification';
        v_reason := 'Some values could not be read with confidence';
      else
        v_status := 'processed';
      end if;
    end if;
  elsif p_routed_table in ('ecg_report_documents', 'imaging_report_documents') then
    -- Step 5: ECG and imaging documents. Both tables show a patient every document on their own record (their select policies
    -- are patient_id = auth.uid()), and both open a clinician review alert on every upload; the intake mirrors that.
    if p_routed_table = 'ecg_report_documents' then
      select reviewed_at, clinician_alert_id into v_reviewed_at, v_alert from public.ecg_report_documents where id = p_routed_id;
    else
      select reviewed_at, clinician_alert_id into v_reviewed_at, v_alert from public.imaging_report_documents where id = p_routed_id;
    end if;
    if not found then return; end if;
    v_visible := true;
    if v_reviewed_at is not null then
      v_status := 'reviewed';
    elsif v_alert is not null then
      v_status := 'doctor_review_required';
    else
      v_status := 'uploaded';
    end if;
  else
    -- An S27 file: its status is the status of the result it belongs to (the latest, if corrected). Patient visibility mirrors
    -- the lab_results patient read policy exactly: not withdrawn, and released, or added by the patient and not withheld.
    select * into r from public.lab_results where document_id = p_routed_id order by created_at desc limit 1;
    if not found then
      v_status := 'uploaded';
    else
      v_visible := r.withdrawn_at is null
                   and (r.release_state = 'released' or (r.submitted_by_kind = 'patient' and r.release_state <> 'withheld'));
      if r.withdrawn_at is not null then
        v_status := 'reviewed'; v_reason := 'Withdrawn by a clinician';
      elsif r.release_state in ('awaiting_review', 'clinician_disclosure_required') then
        v_status := 'doctor_review_required';
      else
        v_status := 'reviewed'; -- released, or withheld by a clinician
      end if;
    end if;
  end if;

  update public.clinical_documents
     set status = v_status,
         status_reason = v_reason,
         status_changed_at = case when status is distinct from v_status then now() else status_changed_at end,
         visible_to_patient = v_visible,
         is_superseded = is_superseded or v_superseded,
         extraction_attempts = (select count(*) from public.clinical_document_jobs j where j.document_id = v_cd.id and j.step = 'extract'),
         failed_attempts = (select count(*) from public.clinical_document_jobs j
                             where j.document_id = v_cd.id and j.step = 'extract' and j.outcome = 'failed'
                               and j.created_at > coalesce((select max(s.created_at) from public.clinical_document_jobs s
                                                             where s.document_id = v_cd.id and s.step = 'extract' and s.outcome = 'succeeded'), '-infinity')),
         last_error = (select j.error from public.clinical_document_jobs j where j.document_id = v_cd.id and j.step = 'extract' order by j.created_at desc limit 1)
   where id = v_cd.id;
end;
$function$;
revoke all on function private.cde_refresh(text, uuid) from public, anon, authenticated;


create or replace function private.cde_on_ecg_imaging_document()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform private.cde_open_intake(new.organisation_id, new.patient_id,
      case new.source::text
        when 'patient' then 'patient_app'
        when 'lab_liaison' then 'lab_liaison'
        when 'clinician' then 'clinician'
        when 'admin' then 'admin'
        when 'provider_portal' then 'partner_integration'
        else 'other'
      end,
      new.uploaded_by, new.content_sha256, new.mime_type, tg_table_name::text, new.id);
  else
    perform private.cde_refresh(tg_table_name::text, new.id);
  end if;
  return null;
end;
$function$;
revoke all on function private.cde_on_ecg_imaging_document() from public, anon, authenticated;

create trigger cde_intake_on_ecg_document after insert or update of reviewed_at, clinician_alert_id on public.ecg_report_documents
  for each row execute function private.cde_on_ecg_imaging_document();
create trigger cde_intake_on_imaging_document after insert or update of reviewed_at, clinician_alert_id on public.imaging_report_documents
  for each row execute function private.cde_on_ecg_imaging_document();

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Opening the intake record (adopts an ECG or imaging routing too) and applying a kind (redefined from 20261104184341)
-- ---------------------------------------------------------------------------------------------------------------------------
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
    -- Steps 4 and 5: an unsorted upload whose kind is now known is routed by inserting the specialised row for the same file (a lab,
    -- ECG or imaging document). That insert lands here; the waiting intake row becomes the routed one, so the document keeps one
    -- record and one history.
    select cd.id into v_existing from public.clinical_documents cd
      join public.clinical_document_kinds k on k.code = cd.kind_code
     where cd.patient_id = p_patient and cd.content_sha256 = p_sha and not cd.is_superseded
       and cd.routed_table is null
       and ((k.pipeline = 'lab' and p_routed_table = 'lab_result_documents')
            or (k.pipeline = 'ecg' and p_routed_table = 'ecg_report_documents')
            or (k.pipeline in ('imaging', 'mammography') and p_routed_table = 'imaging_report_documents'))
     limit 1
     for update of cd;
    if v_existing is not null then
      update public.clinical_documents set routed_table = p_routed_table, routed_id = p_routed_id where id = v_existing;
      perform private.cde_refresh(p_routed_table, p_routed_id);
      return;
    end if;

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
  values (p_org, p_patient, p_channel, p_uploaded_by,
      case p_routed_table when 'ecg_report_documents' then 'cardiology.ecg' when 'imaging_report_documents' then 'imaging' else 'lab' end,
      'pipeline',
      case when p_routed_table = 'imaging_report_documents'
           then coalesce((select access_category from public.imaging_report_documents where id = p_routed_id), 'labs_results')
           else 'labs_results' end,
      'uploaded', p_sha, p_mime,
      p_routed_table, p_routed_id, coalesce((select is_test from public.profiles where id = p_patient), false))
  returning id into v_cd;

  perform private.cde_refresh(p_routed_table, p_routed_id);

  -- CDE-08: a values-free notice for a report the care team added. The payload is the intake id only; the wording is fixed.
  -- (ECG and imaging uploads already tell the patient through their own handlers, so only the lab stores send it here.)
  if p_channel in ('care_coordinator', 'lab_liaison', 'clinician', 'admin')
     and p_routed_table in ('lab_result_documents', 'lab_result_files') then
    perform private.lab_notify(p_patient, p_org, 'lab_report_received', jsonb_build_object('clinical_document_id', v_cd));
  end if;
end;
$function$;
revoke all on function private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function private.cde_apply_kind(p_document uuid, p_kind text, p_source text, p_actor uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  cd public.clinical_documents;
  k public.clinical_document_kinds;
  v_alert uuid;
  v_review boolean;
begin
  select * into cd from public.clinical_documents where id = p_document for update;
  if not found then raise exception 'clinical document not found' using errcode = 'P0002'; end if;
  if cd.routed_table is not null then raise exception 'clinical_document_already_routed' using errcode = '55000'; end if;
  select * into k from public.clinical_document_kinds where code = p_kind and is_active;
  if not found or k.pipeline is null then raise exception 'clinical_document_kind_not_specific' using errcode = '22023'; end if;

  update public.clinical_documents
     set kind_code = k.code, kind_source = p_source, access_category = k.access_category,
         kind_confirmed_by = case when p_source = 'confirmed' then p_actor else kind_confirmed_by end,
         kind_confirmed_at = case when p_source = 'confirmed' then now() else kind_confirmed_at end
   where id = cd.id;

  if k.pipeline = 'lab' then
    -- An ordinary patient lab upload of the same stored file. Its insert trigger opens the review alert per the patient's plan and
    -- private.cde_open_intake adopts this intake row; the app then starts the AI-005 reader on the new row.
    insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
        source, uploaded_by, note, content_sha256)
    values (cd.organisation_id, cd.patient_id, cd.file_path, cd.original_filename, cd.mime_type, cd.file_size_bytes,
        'patient', cd.uploaded_by, cd.patient_note, cd.content_sha256);
    return k.pipeline;
  end if;

  if k.pipeline in ('ecg', 'imaging', 'mammography') then
    -- Step 5: these readers keep their files in their own buckets, which the database cannot copy. The server copies the file and
    -- calls public.route_clinical_document, which inserts the ECG or imaging row (whose own handler opens the review alert). Until
    -- then the document waits here; a stuck one is on the ops exception queue after 30 minutes and the daily sweep retries it.
    update public.clinical_documents
       set status = 'processing', status_reason = 'Sending to the right reader', status_changed_at = now()
     where id = cd.id;
    return k.pipeline;
  end if;

  -- Pathology, cervical and narrative documents have no reader routed through the intake yet. Same review rule as a patient's
  -- own lab upload.
  v_review := exists (select 1 from public.programme_purchases pp
                       where pp.patient_id = cd.patient_id and pp.status = 'active' and pp.ends_at >= current_date);
  if v_review and cd.clinician_alert_id is null then
    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (cd.organisation_id, cd.patient_id, 'clinician_review', 'open',
      format('%s uploaded by the patient: review needed', k.label),
      format('The patient uploaded a document sorted as "%s" (%s). Open it under "Uploaded documents not yet read automatically" '
             'on the patient''s record, and record the review there with any clinical finding. There is no automatic reader for this '
             'kind yet.', k.label,
             case p_source when 'confirmed' then 'the patient chose the type' when 'ai' then 'type suggested by AI-024'
                           when 'rules' then 'type found from the file name or note' else p_source end), 2)
    returning id into v_alert;
  end if;

  update public.clinical_documents
     set clinician_alert_id = coalesce(clinician_alert_id, v_alert),
         status = case when coalesce(clinician_alert_id, v_alert) is not null then 'doctor_review_required' else 'uploaded' end,
         status_reason = case when coalesce(clinician_alert_id, v_alert) is not null
                              then 'A doctor will look at this document'
                              else 'Kept on your record. Your plan does not include a doctor''s review of uploaded documents' end,
         status_changed_at = now()
   where id = cd.id;
  return k.pipeline;
end;
$function$;
revoke all on function private.cde_apply_kind(uuid, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Routing a sorted "Not sure" upload into the ECG or imaging store (server only, after it copied the file)
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.route_clinical_document(p_document uuid, p_file_path text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  cd public.clinical_documents;
  k public.clinical_document_kinds;
  v_id uuid;
  v_bucket text;
begin
  select * into cd from public.clinical_documents where id = p_document for update;
  if not found then raise exception 'clinical document not found' using errcode = 'P0002'; end if;
  select * into k from public.clinical_document_kinds where code = cd.kind_code;
  -- Only a sorted upload still waiting for its reader: a reviewed one (a doctor already read it from the review section) or a
  -- routed one is never routed again.
  if cd.routed_table is not null or cd.status <> 'processing' or k.pipeline is null or k.pipeline not in ('ecg', 'imaging', 'mammography') then
    raise exception 'clinical_document_not_waiting_for_a_reader' using errcode = '55000';
  end if;
  v_bucket := case when k.pipeline = 'ecg' then 'ecg-reports' else 'imaging-reports' end;
  if p_file_path is null or split_part(p_file_path, '/', 1) <> cd.patient_id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = p_file_path) then
    raise exception 'clinical_document_file_missing' using errcode = '22023';
  end if;

  if k.pipeline = 'ecg' then
    insert into public.ecg_report_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
        source, uploaded_by, note, content_sha256)
    values (cd.organisation_id, cd.patient_id, p_file_path, cd.original_filename, cd.mime_type, cd.file_size_bytes,
        'patient', cd.uploaded_by, cd.patient_note, cd.content_sha256)
    returning id into v_id;
  else
    insert into public.imaging_report_documents (organisation_id, patient_id, file_path, original_filename, mime_type,
        file_size_bytes, source, uploaded_by, note, content_sha256, access_category)
    values (cd.organisation_id, cd.patient_id, p_file_path, cd.original_filename, cd.mime_type, cd.file_size_bytes,
        'patient', cd.uploaded_by, cd.patient_note, cd.content_sha256, k.access_category)
    returning id into v_id;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.route_clinical_document(uuid, text) from public, anon, authenticated;
grant execute on function public.route_clinical_document(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.route_clinical_document(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.route_clinical_document(uuid, text)', 'EXECUTE') then
    raise exception 'route_clinical_document must be service-role only';
  end if;
  if exists (select 1 from pg_policy where polrelid in ('public.imaging_report_documents'::regclass, 'public.imaging_reports'::regclass)
              and coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') like '%''labs_results''%') then
    raise exception 'an imaging policy still reads a fixed category';
  end if;
end;
$$;
