-- Clinical document engine, step 2: the Care Coordinator uploads a lab report for a patient (decision CDE-03: there is no
-- separate Laboratory Liaison role; every liaison function is a Care Coordinator function), with a patient search that never
-- matches on a name alone, an identity check the database verifies, the laboratory recorded apart from the person who uploaded
-- it, and laboratory assignments. Also closes step 1's fingerprint gaps (a patient's replacement upload, a patient-added S27 file).
-- Design: docs/plans/clinical-document-engine-2026-11-04.md §5; decisions CDE-03, CDE-04, CDE-06.
--
--   1. public.find_patient_for_upload(query, date_of_birth): patient number, phone, email, or name WITH date of birth. A name alone
--      is refused. Returns only what is needed to tell two patients apart (name, year of birth, sex, state, the last four characters
--      of the patient number and of the phone). Neither the full date of birth nor the full patient number is shown, so the identity
--      check on upload has to be answered from the report. Care coordinators (and the legacy lab_liaison role), own organisation, every search audited.
--   2. public.coordinator_submit_lab_report(...): stores the file as a held S27 result exactly like the care-team path
--      (team_submit_lab_result), so the clinician release machine, alerts and INV-03 (the patient sees nothing until a clinician has
--      reviewed it) are unchanged. Before it does, the database checks the identity the coordinator read off the report against the
--      record: two name words in common AND the date of birth or the patient number. A date of birth that does not match refuses the
--      upload outright. The file fingerprint is required. The intake row records what matched, the laboratory and the test date.
--   3. public.correct_clinical_document_metadata(...): the uploader corrects administrative details (test date, laboratory, note;
--      a directory laboratory and a typed name replace each other, an empty note clears it)
--      on their own upload until a clinician has reviewed it. Never a value, a finding or the patient. Audited with the old values.
--   4. public.staff_lab_assignments: which laboratories a coordinator handles (admin-managed). For the coordinator's screen and the
--      admin's statistics, not a restriction on whose result can be uploaded: a lab can send a result for any Tarragon patient.
--   5. Fingerprint gaps: replace_my_result_document gains p_content_sha256 (dropped and re-created from its live body, one trailing
--      defaulted argument, so no overload exists to make an untyped call ambiguous); patient_add_lab_result passes the fingerprint
--      in p_file on, as team_submit_lab_result does.
--
-- Not changed (deliberately): a care-team upload does not notify the patient. The spec asks for an upload notification; S27d INV-03
-- (the patient is told only after a clinician has reviewed a result someone else supplied) stands until the founder decides
-- otherwise (OQ-CDE-08). Coordinators still never interpret, release, close an alert or prescribe: the result is held for a doctor.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 0. Intake row: what the identity check matched, and an administrative note
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.clinical_documents add column identity_check jsonb;
alter table public.clinical_documents add column admin_note text check (admin_note is null or length(admin_note) <= 1000);
alter table public.clinical_documents add constraint clinical_documents_facility_name_len
  check (source_facility_name is null or length(source_facility_name) <= 200);

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Laboratory assignments
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.staff_lab_assignments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  staff_profile_id uuid not null references public.profiles (id) on delete restrict,
  lab_provider_id  uuid not null references public.lab_providers (id) on delete restrict,
  active_from      date not null default ((now() at time zone 'Africa/Lagos')::date),
  active_to        date,
  assigned_by      uuid references public.profiles (id) on delete restrict,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint staff_lab_assignments_dates check (active_to is null or active_to >= active_from)
);
create unique index staff_lab_assignments_one_open on public.staff_lab_assignments (staff_profile_id, lab_provider_id)
  where active_to is null;
-- Only a care coordinator (or the legacy lab_liaison account) of the same organisation can hold a laboratory assignment.
create or replace function private.guard_staff_lab_assignment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.profiles p where p.id = new.staff_profile_id and p.organisation_id = new.organisation_id
                   and p.role in ('care_coordinator', 'lab_liaison')) then
    raise exception 'staff_lab_assignment_not_a_coordinator' using errcode = '22023';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_staff_lab_assignment() from public;
create trigger staff_lab_assignments_guard before insert or update of staff_profile_id, organisation_id on public.staff_lab_assignments
  for each row execute function private.guard_staff_lab_assignment();
create trigger staff_lab_assignments_set_updated_at before update on public.staff_lab_assignments
  for each row execute function private.set_updated_at();
create trigger audit_row_change_trg after insert or delete or update on public.staff_lab_assignments
  for each row execute function private.audit_row_change();

alter table public.staff_lab_assignments enable row level security;
create policy staff_lab_assignments_read on public.staff_lab_assignments for select to authenticated
  using (staff_profile_id = (select auth.uid()) or private.is_admin());
create policy staff_lab_assignments_admin_insert on public.staff_lab_assignments for insert to authenticated
  with check (private.is_admin());
create policy staff_lab_assignments_admin_update on public.staff_lab_assignments for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.staff_lab_assignments from anon;
grant select, insert, update on public.staff_lab_assignments to authenticated;
revoke delete, truncate on public.staff_lab_assignments from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Who may upload for a patient on the care team's behalf (logistics, CDE-03)
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function private.cde_uploader_org()
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select organisation_id from public.profiles
   where id = (select auth.uid()) and is_active and role in ('care_coordinator', 'lab_liaison') and organisation_id is not null;
$function$;

-- Lower-case words of two letters or more, punctuation dropped: "OKAFOR, Ngozi A." -> {okafor, ngozi}
create or replace function private.cde_name_words(p text)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select coalesce(array_agg(distinct w), '{}')
    from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p, ''), '[^[:alpha:][:space:]-]', ' ', 'g')), '[[:space:]-]+')) w
   where length(w) >= 2;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Patient search: never a name alone
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.find_patient_for_upload(p_query text, p_date_of_birth date default null)
returns table (patient_id uuid, patient_number_hint text, full_name text, birth_year integer, sex text, state text, phone_last4 text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.cde_uploader_org();
  v_q text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_kind text;
  v_words text[];
  v_n integer;
begin
  if v_org is null then
    raise exception 'only a care coordinator can look up a patient to upload a report for them' using errcode = '42501';
  end if;
  if length(v_q) < 3 then
    raise exception 'find_patient_query_too_short' using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles p where p.organisation_id = v_org and p.role = 'patient' and lower(p.patient_number) = lower(v_q)) then
    v_kind := 'patient_number';
  elsif position('@' in v_q) > 0 then
    v_kind := 'email';
  elsif length(v_digits) >= 7 and length(v_digits) >= length(regexp_replace(v_q, '[[:space:]+()-]', '', 'g')) then
    v_kind := 'phone';
  else
    v_kind := 'name';
    if p_date_of_birth is null then
      raise exception 'find_patient_name_needs_date_of_birth' using errcode = '22023';
    end if;
    v_words := private.cde_name_words(v_q);
    if cardinality(v_words) = 0 then
      raise exception 'find_patient_query_too_short' using errcode = '22023';
    end if;
  end if;

  return query
    -- The patient number is masked like the phone: the screen helps tell two people apart, but the identity check on upload must be
    -- answered from the report, not copied from this result.
    select p.id, case when p.patient_number is null then null else '…' || right(p.patient_number, 4) end, p.full_name, extract(year from p.date_of_birth)::integer, p.sex::text, p.state,
           case when p.phone is null then null else right(regexp_replace(p.phone, '\D', '', 'g'), 4) end
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.organisation_id = v_org and p.role = 'patient' and p.is_active
       and (v_kind <> 'name' or p.date_of_birth = p_date_of_birth)
       and case v_kind
             when 'patient_number' then lower(p.patient_number) = lower(v_q)
             when 'email' then lower(u.email) = lower(v_q)
             -- the last 10 digits, so +2348031234567, 08031234567 and 8031234567 are the same number
             when 'phone' then right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10)
             else private.cde_name_words(p.full_name) @> v_words
           end
     order by p.full_name
     limit 10;
  get diagnostics v_n = row_count;

  -- What kind of search and how many it found; never the search text, which is itself personal data.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'patient.upload_search', 'profiles', null, jsonb_build_object('query_kind', v_kind, 'results', v_n));
end;
$function$;

revoke all on function public.find_patient_for_upload(text, date) from public;
revoke all on function public.find_patient_for_upload(text, date) from anon;
grant execute on function public.find_patient_for_upload(text, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. The coordinator's upload
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.coordinator_submit_lab_report(
  p_patient uuid,
  p_file jsonb,
  p_identity jsonb,
  p_source_facility_id uuid default null,
  p_source_facility_name text default null,
  p_investigation_date date default null,
  p_admin_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.cde_uploader_org();
  pr public.profiles;
  v_sha text := p_file ->> 'content_sha256';
  v_name_on_report text := btrim(coalesce(p_identity ->> 'name_on_report', ''));
  v_dob_on_report date;
  v_number_on_report text := nullif(btrim(coalesce(p_identity ->> 'patient_number_on_report', '')), '');
  v_shared integer;
  v_record_words integer;
  v_matched text[] := '{}';
  v_out jsonb;
  v_cd uuid;
begin
  if v_org is null then
    raise exception 'This action is for care coordinators' using errcode = '42501';
  end if;
  select * into pr from public.profiles where id = p_patient;
  if not found or pr.role <> 'patient' or not pr.is_active or pr.organisation_id is distinct from v_org then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'lab_file_hash_invalid' using errcode = '22023';
  end if;
  if p_investigation_date is not null and p_investigation_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'investigation_date_in_future' using errcode = '22023';
  end if;
  if p_source_facility_id is null and nullif(btrim(coalesce(p_source_facility_name, '')), '') is null then
    raise exception 'source_facility_required' using errcode = '22023';
  end if;

  -- Identity: the details printed on the report, checked against the record here, never trusted from the screen.
  begin
    v_dob_on_report := nullif(btrim(coalesce(p_identity ->> 'date_of_birth_on_report', '')), '')::date;
  exception when others then
    raise exception 'identity_date_invalid' using errcode = '22023';
  end;
  -- Two name words in common, or every word when the record holds only one (a single-name record must still be uploadable).
  v_record_words := cardinality(private.cde_name_words(pr.full_name));
  select count(*) into v_shared
    from unnest(private.cde_name_words(v_name_on_report)) w
   where w = any (private.cde_name_words(pr.full_name));
  if v_shared < least(2, v_record_words) or v_shared = 0 then
    raise exception 'identity_name_mismatch' using errcode = '22023';
  end if;
  v_matched := array_append(v_matched, 'name');
  if v_dob_on_report is not null then
    if pr.date_of_birth is distinct from v_dob_on_report then
      raise exception 'identity_date_of_birth_mismatch' using errcode = '22023';
    end if;
    v_matched := array_append(v_matched, 'date_of_birth');
  end if;
  if v_number_on_report is not null then
    if lower(coalesce(pr.patient_number, '')) <> lower(v_number_on_report) then
      raise exception 'identity_patient_number_mismatch' using errcode = '22023';
    end if;
    v_matched := array_append(v_matched, 'patient_number');
  end if;
  if cardinality(v_matched) < 2 then
    raise exception 'identity_second_identifier_required' using errcode = '22023';
  end if;

  perform set_config('tarragon.upload_sha256', v_sha, true);
  v_out := private.submit_lab_result(p_patient, null, null, null, p_file, 'tarragon_team', v_uid, null);
  perform set_config('tarragon.upload_sha256', '', true);

  update public.clinical_documents
     set identity_check = jsonb_build_object('matched_on', to_jsonb(v_matched), 'confirmed_by', v_uid, 'confirmed_at', now()),
         source_facility_id = p_source_facility_id,
         source_facility_name = nullif(btrim(coalesce(p_source_facility_name, '')), ''),
         investigation_date = p_investigation_date,
         admin_note = nullif(btrim(coalesce(p_admin_note, '')), '')
   where patient_id = p_patient and content_sha256 = v_sha and routed_table = 'lab_result_files' and not is_superseded
  returning id into v_cd;
  if v_cd is null then
    raise exception 'clinical_document_intake_missing' using errcode = 'P0001';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event)
  values (v_org, v_uid, 'clinical_document.uploaded_for_patient', 'clinical_documents', v_cd, p_patient,
          jsonb_build_object('matched_on', to_jsonb(v_matched), 'source_facility_id', p_source_facility_id,
                             'lab_result_id', v_out ->> 'lab_result_id'));

  return jsonb_build_object('ok', true, 'document_id', v_cd, 'lab_result_id', v_out ->> 'lab_result_id');
end;
$function$;

revoke all on function public.coordinator_submit_lab_report(uuid, jsonb, jsonb, uuid, text, date, text) from public;
revoke all on function public.coordinator_submit_lab_report(uuid, jsonb, jsonb, uuid, text, date, text) from anon;
grant execute on function public.coordinator_submit_lab_report(uuid, jsonb, jsonb, uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Administrative corrections by the uploader
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.correct_clinical_document_metadata(
  p_document uuid,
  p_reason text,
  p_investigation_date date default null,
  p_source_facility_id uuid default null,
  p_source_facility_name text default null,
  p_admin_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  cd public.clinical_documents;
begin
  select * into cd from public.clinical_documents where id = p_document for update;
  if not found or cd.uploaded_by is distinct from v_uid or cd.patient_id = v_uid then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if cd.status in ('reviewed', 'superseded') then
    raise exception 'clinical_document_already_reviewed' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_investigation_date is not null and p_investigation_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'investigation_date_in_future' using errcode = '22023';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event)
  values (cd.organisation_id, v_uid, 'clinical_document.metadata_corrected', 'clinical_documents', cd.id, cd.patient_id,
          jsonb_build_object('reason', btrim(p_reason),
                             'before', jsonb_build_object('investigation_date', cd.investigation_date, 'source_facility_id', cd.source_facility_id,
                                                          'source_facility_name', cd.source_facility_name, 'admin_note', cd.admin_note)));

  update public.clinical_documents
     set investigation_date = coalesce(p_investigation_date, investigation_date),
         -- A laboratory is either a directory entry or a typed name: choosing one replaces the other.
         source_facility_id = case
                                when p_source_facility_id is not null then p_source_facility_id
                                when nullif(btrim(coalesce(p_source_facility_name, '')), '') is not null then null
                                else source_facility_id
                              end,
         source_facility_name = case
                                  when p_source_facility_id is not null then null
                                  when nullif(btrim(coalesce(p_source_facility_name, '')), '') is not null then btrim(p_source_facility_name)
                                  else source_facility_name
                                end,
         -- null leaves the note as it is; an empty string clears it
         admin_note = case when p_admin_note is null then admin_note else nullif(btrim(p_admin_note), '') end
   where id = cd.id;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.correct_clinical_document_metadata(uuid, text, date, uuid, text, text) from public;
revoke all on function public.correct_clinical_document_metadata(uuid, text, date, uuid, text, text) from anon;
grant execute on function public.correct_clinical_document_metadata(uuid, text, date, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. Fingerprint gaps from step 1
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.patient_add_lab_result(p_file jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v uuid := (select auth.uid()); v_out jsonb;
begin
  if v is null or not exists (select 1 from public.profiles where id = v and role = 'patient') then
    raise exception 'This action is for patients' using errcode = '42501';
  end if;
  if p_file is not null and (p_file ->> 'content_sha256') is not null and (p_file ->> 'content_sha256') !~ '^[0-9a-f]{64}$' then
    raise exception 'lab_file_hash_invalid' using errcode = '22023';
  end if;
  perform set_config('tarragon.upload_sha256', coalesce(p_file ->> 'content_sha256', ''), true);
  v_out := private.submit_lab_result(v, null, null, null, p_file, 'patient', v, null);
  perform set_config('tarragon.upload_sha256', '', true);
  return v_out;
end;
$function$;

-- One function, one trailing defaulted argument: dropped and re-created rather than overloaded, so an existing call with
-- untyped literals still resolves to exactly one function (CLAUDE.md: the can_read_clinical overload lesson).
drop function public.replace_my_result_document(uuid, text, text, text, bigint, text);
CREATE OR REPLACE FUNCTION public.replace_my_result_document(p_document_id uuid, p_file_path text, p_original_filename text, p_mime_type text, p_file_size_bytes bigint, p_note text DEFAULT NULL::text, p_content_sha256 text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_old public.lab_result_documents%rowtype;
  v_new uuid;
  v_new_alert uuid;
  v_oa public.clinician_alerts%rowtype;
  v_na public.clinician_alerts%rowtype;
  v_handover boolean := false;
  v_eff public.alert_level;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_old from public.lab_result_documents where id = p_document_id for update;
  if not found or v_old.patient_id <> v_uid or v_old.source <> 'patient' then
    raise exception 'That upload isn''t yours to replace.' using errcode = '42501';
  end if;
  if v_old.reviewed_at is not null then
    raise exception 'Your care team has already reviewed this one. Message them instead.' using errcode = '55000';
  end if;
  if v_old.superseded_by_document_id is not null then
    raise exception 'That upload was already replaced.' using errcode = '55000';
  end if;
  if p_file_path is null or p_file_path not like v_uid::text || '/%' or p_file_path = v_old.file_path then
    raise exception 'The replacement file must be a new file in your own folder.' using errcode = '22023';
  end if;
  if p_mime_type is null or p_file_size_bytes is null or p_file_size_bytes <= 0 then
    raise exception 'The replacement file details are missing.' using errcode = '22023';
  end if;
  if p_content_sha256 is not null and p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The replacement file details are missing.' using errcode = '22023';
  end if;

  -- Tells private.enforce_lab_result_document_update that this transaction is the sanctioned replace (transaction-local).
  perform set_config('app.result_document_replace', 'on', true);

  begin
    if v_old.clinician_alert_id is not null then
      select * into v_oa from public.clinician_alerts where id = v_old.clinician_alert_id for update;
      if found and v_oa.status not in ('resolved', 'closed') then
        v_handover := true;
        update public.clinician_alerts
           set status = 'resolved',
               resolution_action = 'Handed over: the patient replaced the uploaded file before review. The review continues on the replacement document''s alert.',
               resolution_outcome = 'no_action_needed',
               detail = coalesce(detail, '') || E'\n\nResolved automatically: the patient replaced the uploaded file. The review continues on the replacement document.'
         where id = v_oa.id;
      end if;
    end if;

    insert into public.lab_result_documents
      (organisation_id, patient_id, lab_order_id, screening_completion_id, file_path, original_filename, mime_type, file_size_bytes,
       source, uploaded_by, note, test_code, content_sha256)
    values
      (v_old.organisation_id, v_old.patient_id, v_old.lab_order_id, v_old.screening_completion_id, p_file_path, p_original_filename,
       p_mime_type, p_file_size_bytes, 'patient', v_uid, coalesce(nullif(btrim(p_note), ''), v_old.note), v_old.test_code, p_content_sha256)
    returning id, clinician_alert_id into v_new, v_new_alert;

    if v_handover and v_new_alert is null then
      -- nothing to hand the review to: undo the resolve and the insert, then refuse (handler below)
      raise exception 'replacement opened no review alert' using errcode = 'RP001';
    end if;
  exception when sqlstate 'RP001' then
    raise exception 'Your care team cannot review a new file for this upload right now. Message them instead.' using errcode = '55000';
  end;

  -- the existing mechanism stamps the old row (superseded_by_document_id, superseded_at)
  update public.lab_result_documents set supersedes_document_id = v_old.id where id = v_new;

  -- values read from the file the patient said was wrong must not be confirmable into the record
  update public.lab_report_extractions set status = 'discarded' where document_id = v_old.id and status = 'extracted';

  if v_handover then
    select * into v_na from public.clinician_alerts where id = v_new_alert for update;
    v_eff := greatest(coalesce(v_na.override_level, v_na.level), coalesce(v_oa.override_level, v_oa.level));
    update public.clinician_alerts
       set level = v_eff,
           severity = case v_eff when 'emergency' then 4 when 'urgent_escalation' then 3 when 'clinician_review' then 2 when 'routine' then 1 else severity end,
           escalation_level = greatest(coalesce(v_na.escalation_level, 0), coalesce(v_oa.escalation_level, 0)),
           sla_due_at = case when v_na.sla_due_at is null then v_oa.sla_due_at when v_oa.sla_due_at is null then v_na.sla_due_at
                             else least(v_na.sla_due_at, v_oa.sla_due_at) end,
           detail = coalesce(v_na.detail, '') || E'\n\nThis replaces an earlier upload that the patient swapped for this file. Earlier alert detail: '
                    || coalesce(v_oa.detail, '(none)')
     where id = v_new_alert;
  end if;

  -- an open paid consult request claimed against the old document follows the new file
  update public.lab_result_consult_requests
     set lab_result_document_id = v_new
   where lab_result_document_id = v_old.id and patient_id = v_uid and status not in ('expired', 'cancelled', 'refunded');

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event)
  values (v_old.organisation_id, v_uid, 'lab_result_document.superseded', 'lab_result_documents', v_new, v_uid,
          jsonb_build_object('supersedes_document_id', v_old.id, 'old_alert_id', v_old.clinician_alert_id, 'new_alert_id', v_new_alert,
                             'alert_handed_over', v_handover));

  perform set_config('app.result_document_replace', 'off', true);
  return v_new;
end;
$function$;

revoke all on function public.replace_my_result_document(uuid, text, text, text, bigint, text, text) from public;
revoke all on function public.replace_my_result_document(uuid, text, text, text, bigint, text, text) from anon;
grant execute on function public.replace_my_result_document(uuid, text, text, text, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7. Self-checks
-- ---------------------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.find_patient_for_upload(text,date)',
    'public.coordinator_submit_lab_report(uuid,jsonb,jsonb,uuid,text,date,text)',
    'public.correct_clinical_document_metadata(uuid,text,date,uuid,text,text)',
    'public.replace_my_result_document(uuid,text,text,text,bigint,text,text)',
    'public.patient_add_lab_result(jsonb)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception '% must not be executable by anon', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception '% must be executable by authenticated', f; end if;
  end loop;
  if (select count(*) from pg_proc where proname = 'replace_my_result_document') <> 1 then
    raise exception 'replace_my_result_document must have exactly one definition';
  end if;
  if has_table_privilege('anon', 'public.staff_lab_assignments', 'SELECT') then
    raise exception 'staff_lab_assignments must not be readable by anon';
  end if;
end $$;

select private.rebuild_analytics_clean_views();
