-- Clinical document engine, step 5b: a structured pathology and cervical screening record, and mammography fields as printed.
--
-- Design: docs/plans/clinical-document-engine-2026-11-04.md §7 (pathology, cervical and mammography rows), §18 (as built).
--
--   1. public.pathology_reports: what a doctor files from a kept pathology, cytology, cervical screening or HPV document. Every
--      clinical field is copied AS PRINTED (the diagnosis line verbatim, grade and stage only if printed, the cytology category and
--      HPV result as the laboratory wrote them). Nothing is coded or interpreted by the platform. Filing also records the doctor's
--      review of the document. The record carries the document kind's access category (cervical and HPV: reproductive_health,
--      which break-glass never opens). Staff read it as tied staff; the patient does not see the structured record in this step
--      (the doctor's review note and the status are what the patient sees), because a pathology result is discussed, not posted.
--   2. imaging_reports gains breast density and BI-RADS (left, right, overall) AS PRINTED. The platform never assigns or changes a
--      BI-RADS category; a missing category stays missing (design §7).
--
-- A cervical result filed here does not by itself create a screening_results row: the doctor files that through the existing
-- screening result path, so the abnormal-screening pipeline (Category 2 -> 1) keeps one entry point. Recorded as OQ-CDE-10.
-- Gates (G-01): none added.
-- Live counts before this migration (2026-11-04): imaging_reports 0; pathology documents 0.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Mammography fields as printed
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.imaging_reports
  add column breast_density_as_printed text check (breast_density_as_printed is null or breast_density_as_printed in ('A', 'B', 'C', 'D')),
  add column birads_left_as_printed text check (birads_left_as_printed is null or birads_left_as_printed in ('0', '1', '2', '3', '4', '4A', '4B', '4C', '5', '6')),
  add column birads_right_as_printed text check (birads_right_as_printed is null or birads_right_as_printed in ('0', '1', '2', '3', '4', '4A', '4B', '4C', '5', '6')),
  add column birads_overall_as_printed text check (birads_overall_as_printed is null or birads_overall_as_printed in ('0', '1', '2', '3', '4', '4A', '4B', '4C', '5', '6')),
  -- BI-RADS belongs to a breast study only.
  add constraint imaging_reports_birads_on_breast_only check (
    (birads_left_as_printed is null and birads_right_as_printed is null and birads_overall_as_printed is null and breast_density_as_printed is null)
    or modality in ('mammography', 'ultrasound', 'mri'));

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. The pathology and cervical screening record
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.pathology_reports (
  id                           uuid primary key default gen_random_uuid(),
  organisation_id              uuid not null references public.organisations (id) on delete restrict,
  patient_id                   uuid not null references public.profiles (id) on delete cascade,
  clinical_document_id         uuid not null unique references public.clinical_documents (id) on delete restrict,
  report_kind                  text not null check (report_kind in ('histopathology', 'cytology', 'cervical_cytology', 'hpv')),
  access_category              public.care_access_category not null,
  specimen                     text check (specimen is null or length(specimen) <= 300),
  site                         text check (site is null or length(site) <= 300),
  diagnosis_as_printed         text check (diagnosis_as_printed is null or length(diagnosis_as_printed) <= 4000),
  grade_as_printed             text check (grade_as_printed is null or length(grade_as_printed) <= 200),
  stage_as_printed             text check (stage_as_printed is null or length(stage_as_printed) <= 200),
  cytology_category_as_printed text check (cytology_category_as_printed is null or length(cytology_category_as_printed) <= 300),
  hpv_result_as_printed        text check (hpv_result_as_printed is null or hpv_result_as_printed in ('positive', 'negative', 'invalid')),
  hpv_genotypes_as_printed     text check (hpv_genotypes_as_printed is null or length(hpv_genotypes_as_printed) <= 300),
  recommendation_as_printed    text check (recommendation_as_printed is null or length(recommendation_as_printed) <= 2000),
  pathologist_name             text check (pathologist_name is null or length(pathologist_name) <= 200),
  laboratory_name              text check (laboratory_name is null or length(laboratory_name) <= 200),
  reported_on                  date check (reported_on is null or reported_on <= current_date),
  filed_by                     uuid not null references public.profiles (id) on delete restrict,
  filed_at                     timestamptz not null default now(),
  is_test                      boolean not null default false,
  created_at                   timestamptz not null default now(),
  -- The field that carries the result must be there for each kind.
  constraint pathology_reports_kind_fields check (
    (report_kind in ('histopathology', 'cytology') and diagnosis_as_printed is not null)
    or (report_kind = 'cervical_cytology' and cytology_category_as_printed is not null)
    or (report_kind = 'hpv' and hpv_result_as_printed is not null))
);
create index pathology_reports_patient_idx on public.pathology_reports (patient_id, filed_at desc);

alter table public.pathology_reports enable row level security;
create policy pathology_reports_select on public.pathology_reports for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, access_category));
revoke all on public.pathology_reports from anon;
grant select on public.pathology_reports to authenticated;
revoke insert, update, delete, truncate on public.pathology_reports from authenticated;
create trigger audit_row_change_trg after insert or delete or update on public.pathology_reports
  for each row execute function private.audit_row_change();

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('pathology_reports', 'patient_id', 'clinical_record', 'review', true, false,
        'Pathology, cytology, cervical screening and HPV results copied as printed by a doctor from an uploaded report (CDE step 5b). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('pathology_reports', 'tied', 'patient_id', 'labs_results', 'The row carries its own category (cervical and HPV: reproductive_health); the policy reads it.')
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Filing it (an active clinician who may read the record; files and reviews in one step)
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.file_pathology_report(p_document uuid, p_fields jsonb, p_note text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_me uuid := (select auth.uid());
  cd public.clinical_documents;
  k public.clinical_document_kinds;
  v_kind text := p_fields ->> 'report_kind';
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  f jsonb;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into cd from public.clinical_documents where id = p_document for update;
  if not found or not exists (select 1 from public.profiles pr where pr.id = v_me and pr.role = 'clinician' and pr.organisation_id = cd.organisation_id)
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_me and cs.active)
     or not private.staff_may_read(cd.patient_id, cd.organisation_id, cd.access_category) then
    raise exception 'clinical document not found' using errcode = 'P0002';
  end if;
  select * into k from public.clinical_document_kinds where code = cd.kind_code;
  if cd.routed_table is not null or k.pipeline is null or k.pipeline not in ('pathology', 'cervical') or cd.status = 'reviewed' then
    raise exception 'clinical_document_not_fileable_as_pathology' using errcode = '55000';
  end if;
  if (k.pipeline = 'pathology' and v_kind not in ('histopathology', 'cytology'))
     or (k.pipeline = 'cervical' and v_kind not in ('cervical_cytology', 'hpv')) or v_kind is null then
    raise exception 'pathology_report_kind_does_not_match_document' using errcode = '22023';
  end if;
  if v_note is null then raise exception 'clinical_document_review_note_required' using errcode = '22023'; end if;
  if length(v_note) > 2000 then raise exception 'clinical_document_review_note_too_long' using errcode = '22023'; end if;

  -- Empty strings are absent fields, never a printed value.
  select coalesce(jsonb_object_agg(key, btrim(value #>> '{}')) filter (where nullif(btrim(value #>> '{}'), '') is not null), '{}'::jsonb)
    into f from jsonb_each(coalesce(p_fields, '{}'::jsonb));

  insert into public.pathology_reports (organisation_id, patient_id, clinical_document_id, report_kind, access_category, specimen,
      site, diagnosis_as_printed, grade_as_printed, stage_as_printed, cytology_category_as_printed, hpv_result_as_printed,
      hpv_genotypes_as_printed, recommendation_as_printed, pathologist_name, laboratory_name, reported_on, filed_by, is_test)
  values (cd.organisation_id, cd.patient_id, cd.id, v_kind, cd.access_category, f ->> 'specimen', f ->> 'site',
      f ->> 'diagnosis_as_printed', f ->> 'grade_as_printed', f ->> 'stage_as_printed', f ->> 'cytology_category_as_printed',
      f ->> 'hpv_result_as_printed', f ->> 'hpv_genotypes_as_printed', f ->> 'recommendation_as_printed', f ->> 'pathologist_name',
      f ->> 'laboratory_name', (f ->> 'reported_on')::date, v_me, cd.is_test)
  returning id into v_id;

  update public.clinical_documents
     set status = 'reviewed', status_reason = 'Reviewed by a doctor', status_changed_at = now(),
         reviewed_by = v_me, reviewed_at = now(), review_note = v_note
   where id = cd.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (cd.organisation_id, v_me, 'pathology_report.filed', 'pathology_reports', v_id,
          jsonb_build_object('clinical_document_id', cd.id, 'report_kind', v_kind));
  return v_id;
end;
$function$;
revoke all on function public.file_pathology_report(uuid, jsonb, text) from public, anon;
grant execute on function public.file_pathology_report(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.pathology_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.pathology_reports', 'INSERT')
     or has_function_privilege('anon', 'public.file_pathology_report(uuid, jsonb, text)', 'EXECUTE') then
    raise exception 'pathology_reports grants are wrong';
  end if;
end;
$$;
