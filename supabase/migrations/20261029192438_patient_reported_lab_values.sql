-- Patient-reported lab values: a patient with no doctor time can confirm the numbers read from their own uploaded
-- report and see them on their own trend, clearly labelled as theirs.
--
-- WHY. A report uploaded by a patient is read into a DRAFT (lab_report_extractions). Filing it into the clinical record
-- (lab_analyte_readings) is a clinical act and stays a doctor's (confirm_lab_report_extraction), so a patient whose plan
-- has no doctor time got no trend from their own upload, ever. Founder/CMO instruction 2026-10-29.
--
-- DESIGN, and what it deliberately does NOT do.
--   * A SEPARATE table. lab_analyte_readings feeds doctor-facing metrics (for example the diabetes quality view counts
--     HbA1c at target). An unreviewed number must never reach those, so patient-reported values live here and nowhere else.
--   * They join the trend as a third source, 'patient_reported', with NO flag and NO reference range: nobody has checked
--     them, so the app claims nothing about them.
--   * Only the patient's OWN trend shows them. patient_biomarker_list / patient_biomarker_trend add this source only when the
--     caller is the patient themself; a doctor, caregiver or the health-passport summary reads exactly what they read before.
--   * Only for a report the patient uploaded themselves (lab_result_documents.source = 'patient'), only for codes the reader
--     found on it, and never for sensitive analytes (HIV, hepatitis, syphilis, chlamydia, gonorrhoea).
--   * If a doctor later files the same report, the doctor's values win and the patient-reported copy drops out of the trend,
--     so nothing appears twice.
--   * Writes go through confirm_my_lab_report only: there is no insert, update or delete policy.
--
-- Tables with unrelated names are untouched. biomarker_points is not changed (clinical consumers keep calling it); a new
-- private.biomarker_points_with_reported wraps it, and the two patient functions are patched in place from their LIVE bodies.

create table public.patient_reported_lab_values (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  patient_id      uuid not null references public.profiles(id),
  document_id     uuid not null references public.lab_result_documents(id),
  extraction_id   uuid not null references public.lab_report_extractions(id),
  code            text not null check (char_length(code) between 1 and 80),
  value           numeric not null check (value >= 0 and value <= 1000000),
  unit            text check (unit is null or char_length(unit) <= 30),
  taken_at        timestamptz not null,
  proposed_value  numeric,
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false,
  unique (extraction_id, code)
);
create index patient_reported_lab_values_patient_code on public.patient_reported_lab_values (patient_id, lower(code), taken_at);

comment on table public.patient_reported_lab_values is
  'Numbers a patient confirmed from their own uploaded report. NOT part of the clinical record: never joined into lab_analyte_readings or any clinician metric. Shown only on the patient''s own trend, labelled patient_reported, without flags or ranges.';

alter table public.patient_reported_lab_values enable row level security;

create policy patient_reported_lab_values_select on public.patient_reported_lab_values
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
  );

grant select on public.patient_reported_lab_values to authenticated;
revoke all on public.patient_reported_lab_values from anon, public;

-- 1. What the patient is asked to confirm -------------------------------------------------------------------------------
create or replace function public.my_lab_report_drafts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'document_id', d.id,
             'extraction_id', e.id,
             'filename', d.original_filename,
             'uploaded_at', d.created_at,
             'report_date', e.report_date,
             'confirmed', exists (select 1 from public.patient_reported_lab_values r where r.extraction_id = e.id),
             'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                         'code', x ->> 'code',
                         'label', coalesce(nullif(x ->> 'reportedLabel', ''), x ->> 'code'),
                         'value', nullif(x ->> 'value', '')::numeric,
                         'unit', nullif(x ->> 'unit', ''))), '[]'::jsonb)
                      from jsonb_array_elements(e.rows) x
                      where x ->> 'code' is not null
                        and nullif(x ->> 'value', '') is not null
                        and not private.is_sensitive_analyte_code(x ->> 'code'))
           ) order by d.created_at desc)
      from public.lab_report_extractions e
      join public.lab_result_documents d on d.id = e.document_id
     where e.patient_id = v_uid
       and d.patient_id = v_uid
       and d.source = 'patient'
       and e.status = 'extracted'
  ), '[]'::jsonb);
end $$;

-- Sensitive results are never offered for self-confirmation. Matches the screening catalogue's sensitive codes plus the
-- analyte names the reader emits for them.
create or replace function private.is_sensitive_analyte_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_code is null
      or lower(p_code) ~ '^(hiv|hbsag|hbs|hcv|hep|hepatitis|syphilis|rpr|vdrl|chlamydia|gonorrh|ct_ng)'
      or exists (select 1 from public.screen_types st where st.sensitive and lower(st.code) = lower(p_code))
$$;

-- 2. The patient confirms (or corrects) the numbers ---------------------------------------------------------------------
create or replace function public.confirm_my_lab_report(p_extraction_id uuid, p_readings jsonb, p_report_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.lab_report_extractions%rowtype;
  v_doc public.lab_result_documents%rowtype;
  r jsonb;
  v_code text;
  v_value numeric;
  v_unit text;
  v_proposed numeric;
  v_n integer := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.lab_report_extractions where id = p_extraction_id;
  -- one message for "not found" and "not yours", so an id cannot be probed
  if e.id is null or e.patient_id <> v_uid then raise exception 'report not found' using errcode = '42501'; end if;
  select * into v_doc from public.lab_result_documents where id = e.document_id;
  if v_doc.id is null or v_doc.patient_id <> v_uid or v_doc.source <> 'patient' then
    raise exception 'only a report you uploaded yourself can be confirmed here' using errcode = '42501';
  end if;
  if e.status <> 'extracted' then
    raise exception 'this report has already been filed by your care team or could not be read' using errcode = '22023';
  end if;
  if p_report_date is null or p_report_date > private.lagos_today() or p_report_date < date '1990-01-01' then
    raise exception 'give the date printed on the report' using errcode = '22023';
  end if;
  if p_readings is null or jsonb_typeof(p_readings) <> 'array' or jsonb_array_length(p_readings) = 0
     or jsonb_array_length(p_readings) > 60 then
    raise exception 'confirm between 1 and 60 numbers' using errcode = '22023';
  end if;

  -- a correction replaces the earlier confirmation of the same report
  delete from public.patient_reported_lab_values where extraction_id = e.id;

  for r in select * from jsonb_array_elements(p_readings) loop
    v_code := lower(btrim(r ->> 'code'));
    if v_code is null or v_code = '' then raise exception 'each number needs a code' using errcode = '22023'; end if;
    if private.is_sensitive_analyte_code(v_code) then
      raise exception 'this kind of result is not confirmed here; your care team handles it' using errcode = '22023';
    end if;
    -- only numbers the reader found on this report; a patient cannot add arbitrary analytes
    select nullif(x ->> 'value', '')::numeric into v_proposed
      from jsonb_array_elements(e.rows) x where lower(x ->> 'code') = v_code limit 1;
    if not found then raise exception 'that number is not on this report' using errcode = '22023'; end if;
    begin
      v_value := (r ->> 'value')::numeric;
    exception when others then
      raise exception 'each number must be a number' using errcode = '22023';
    end;
    if v_value is null or v_value < 0 or v_value > 1000000 then
      raise exception 'a number is out of range' using errcode = '22023';
    end if;
    v_unit := nullif(btrim(r ->> 'unit'), '');
    if v_unit is not null and char_length(v_unit) > 30 then raise exception 'the unit is too long' using errcode = '22023'; end if;

    -- midday UTC, as the doctor path does, so a time-zone shift cannot reorder a trend
    insert into public.patient_reported_lab_values
      (organisation_id, patient_id, document_id, extraction_id, code, value, unit, taken_at, proposed_value, is_test)
    values
      (e.organisation_id, v_uid, e.document_id, e.id, v_code, v_value, v_unit,
       (p_report_date::text || ' 12:00:00+00')::timestamptz, v_proposed,
       coalesce((select is_test from public.profiles where id = v_uid), false));
    v_n := v_n + 1;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (e.organisation_id, v_uid, 'patient_reported_lab_values.confirmed', 'lab_report_extractions', e.id,
          jsonb_build_object('readings', v_n, 'document_id', e.document_id));
  return v_n;
end $$;

-- 3. Trend: a third source, only for the patient looking at their own data ---------------------------------------------
create or replace function private.biomarker_points_with_reported(p_patient uuid, p_code text, p_include boolean)
returns table(taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, ref_text text, flag text, source text, laboratory text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.biomarker_points(p_patient, p_code)
  union all
  select r.taken_at, r.value, r.unit, null::numeric, null::numeric, null::text, null::text, 'patient_reported'::text, null::text
    from public.patient_reported_lab_values r
   where p_include
     and r.patient_id = p_patient
     and lower(r.code) = lower(p_code)
     -- the doctor's filing of the same report replaces this copy
     and not exists (select 1 from public.lab_report_extractions e where e.id = r.extraction_id and e.status = 'confirmed')
$$;

do $$
declare
  v_list text := pg_get_functiondef('public.patient_biomarker_list(uuid)'::regprocedure);
  v_trend text := pg_get_functiondef('public.patient_biomarker_trend(text,uuid,date)'::regprocedure);
  v_codes_old constant text := 'union select lower(l.code) from private.lab_analyte_readings_current l where l.patient_id = v_patient) codes';
  v_codes_new constant text := 'union select lower(l.code) from private.lab_analyte_readings_current l where l.patient_id = v_patient union select lower(pr.code) from public.patient_reported_lab_values pr where pr.patient_id = v_patient and v_patient = (select auth.uid())) codes';
  v_old_list constant text := 'private.biomarker_points(v_patient, codes.code)';
  v_new_list constant text := 'private.biomarker_points_with_reported(v_patient, codes.code, v_patient = (select auth.uid()))';
  v_old_trend constant text := 'private.biomarker_points(v_patient, p_code)';
  v_new_trend constant text := 'private.biomarker_points_with_reported(v_patient, p_code, v_patient = (select auth.uid()))';
begin
  if position('biomarker_points_with_reported' in v_list) = 0 then
    -- the list finds its codes with newlines and spaces collapsed differently from the text above, so match on a whitespace-flexible pattern
    v_list := regexp_replace(v_list, 'union\s+select\s+lower\(l\.code\)\s+from\s+private\.lab_analyte_readings_current\s+l\s+where\s+l\.patient_id\s*=\s*v_patient\)\s*codes',
                             replace(v_codes_new, '\', '\\'));
    v_list := replace(v_list, v_old_list, v_new_list);
    if position('patient_reported_lab_values' in v_list) = 0 or position('biomarker_points_with_reported' in v_list) = 0 then
      raise exception 'patient_biomarker_list no longer has the shape this migration patches; re-read it before editing';
    end if;
    execute v_list;
  end if;
  if position('biomarker_points_with_reported' in v_trend) = 0 then
    if position(v_old_trend in v_trend) = 0 then
      raise exception 'patient_biomarker_trend no longer calls biomarker_points(v_patient, p_code); re-read it before editing';
    end if;
    execute replace(v_trend, v_old_trend, v_new_trend);
  end if;
end $$;

-- 4. Who can call what --------------------------------------------------------------------------------------------------
revoke all on function public.my_lab_report_drafts() from public, anon;
revoke all on function public.confirm_my_lab_report(uuid, jsonb, date) from public, anon;
revoke all on function private.is_sensitive_analyte_code(text) from public, anon;
revoke all on function private.biomarker_points_with_reported(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.my_lab_report_drafts() to authenticated;
grant execute on function public.confirm_my_lab_report(uuid, jsonb, date) to authenticated;
grant execute on function private.is_sensitive_analyte_code(text) to authenticated;

-- 5. Self-checks --------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.patient_reported_lab_values', 'SELECT') then raise exception 'anon can read patient_reported_lab_values'; end if;
  if has_function_privilege('anon', 'public.confirm_my_lab_report(uuid,jsonb,date)', 'EXECUTE') then raise exception 'anon can confirm reported values'; end if;
  if has_function_privilege('anon', 'public.my_lab_report_drafts()', 'EXECUTE') then raise exception 'anon can list drafts'; end if;
  if exists (select 1 from pg_policy where polrelid = 'public.patient_reported_lab_values'::regclass and polcmd <> 'r') then
    raise exception 'patient_reported_lab_values must have no write policy; writes go through confirm_my_lab_report only';
  end if;
  if position('patient_reported_lab_values' in pg_get_functiondef('public.patient_biomarker_list(uuid)'::regprocedure)) = 0 then
    raise exception 'patient_biomarker_list was not patched';
  end if;
  if position('biomarker_points_with_reported' in pg_get_functiondef('public.patient_biomarker_trend(text,uuid,date)'::regprocedure)) = 0 then
    raise exception 'patient_biomarker_trend was not patched';
  end if;
  -- the clinical function other consumers call is untouched
  if position('patient_reported' in pg_get_functiondef('private.biomarker_points(uuid,text)'::regprocedure)) > 0 then
    raise exception 'private.biomarker_points must not know about patient-reported values';
  end if;
  if not private.is_sensitive_analyte_code('hiv') or private.is_sensitive_analyte_code('hba1c') then
    raise exception 'is_sensitive_analyte_code misclassifies hiv or hba1c';
  end if;
end $$;
