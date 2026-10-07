-- S44 (Module 2, interoperability), part 3 of 4: the data side of FHIR export (spec 2.10).
--
-- The FHIR resources themselves are built in application code (apps/web/src/lib/fhir) from this snapshot, so the code systems, units and the
-- Nigeria Core / NPHCDA profile settings stay configurable. This function is where the rules that matter are enforced, in the database:
--
--   * WHO may export: the person themself; a Care Circle supporter, section by section, only for the access categories they hold
--     (private.can_read_clinical); a staff member only through the tie, break-glass or support-view rules (private.can_staff_read_clinical)
--     with a written reason, and every staff export writes an audit row (INV-10, INV-12). A refusal RETURNS 'denied' (it does not raise) so the
--     denial's audit row survives.
--   * WHAT is exported, exactly as for a read: lab results only when released, not withdrawn, not replaced and never a sensitive positive
--     (INV-03, INV-04); medicines the person holds now or held; a vaccination marked rejected is left out; a document is exported as
--     metadata only (type, date, type of file, how it got in) and never its text, its file or any value read from a photo.
--   * Mental health and reproductive health are NOT sections, so they cannot be chosen by accident and are listed in `excluded_domains`.
--     The limit found in S43 still applies and is reported in `limits`: an item inside a general section is not classified by what it is for
--     (OQ-S43-4, OQ-S44-3).
--   * A person's private notes and labels (patient_item_notes) are never in the snapshot.
--
-- fhir_export_log records each export (who, which sections, which were refused). The person can read their own log.

create table public.fhir_export_log (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  requested_by     uuid references public.profiles (id) on delete set null,
  requester_kind   text not null check (requester_kind in ('self', 'supporter', 'staff')),
  sections         text[] not null,
  refused_sections text[] not null default '{}',
  resource_count   integer not null default 0,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index fhir_export_log_patient_idx on public.fhir_export_log (patient_id, created_at desc);
alter table public.fhir_export_log enable row level security;
create policy fhir_export_log_select_own on public.fhir_export_log
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.fhir_export_log from anon, authenticated;
grant select on public.fhir_export_log to authenticated;

create or replace function public.fhir_export_snapshot(p_patient uuid, p_sections text[] default null, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c_cap constant integer := 1000;                      -- technical page size per section, not a clinical value
  v_uid uuid := (select auth.uid());
  v_all constant text[] := array['vitals', 'lab_results', 'medications', 'conditions', 'allergies', 'immunizations', 'documents'];
  v_req text[];
  v_ok text[] := '{}';
  v_refused text[] := '{}';
  v_kind text;
  v_prof public.profiles%rowtype;
  v_sec text;
  v_cat public.care_access_category;
  v_allowed boolean;
  v_out jsonb;
  v_n integer := 0;
  v_part jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_prof from public.profiles where id = p_patient and role = 'patient';
  if not found then return jsonb_build_object('status', 'denied'); end if;

  v_req := coalesce(p_sections, v_all);
  if exists (select 1 from unnest(v_req) s where s <> all (v_all)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;

  if v_uid = p_patient then
    v_kind := 'self';
  elsif exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    v_kind := 'supporter';
  else
    v_kind := 'staff';
    if p_reason is null or char_length(btrim(p_reason)) < 10 then
      raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
    end if;
  end if;

  foreach v_sec in array v_req loop
    v_cat := case v_sec when 'vitals' then 'vitals_readings' when 'lab_results' then 'labs_results' when 'medications' then 'medications'
                        when 'immunizations' then 'vaccinations' else 'medical_history' end::public.care_access_category;
    v_allowed := case v_kind when 'self' then true
                             when 'supporter' then private.can_read_clinical(p_patient, v_cat)
                             else private.can_staff_read_clinical(p_patient, v_cat) end;
    if v_allowed then v_ok := v_ok || v_sec; else v_refused := v_refused || v_sec; end if;
  end loop;

  if cardinality(v_ok) = 0 then
    if v_kind = 'staff' then perform private.audit_chart_read(p_patient, v_req, p_reason, 'denied'); end if;
    return jsonb_build_object('status', 'denied');
  end if;

  v_out := jsonb_build_object(
    'status', 'ok', 'generated_at', now(), 'requester_kind', v_kind,
    'sections_included', to_jsonb(v_ok), 'sections_refused', to_jsonb(v_refused),
    'excluded_domains', jsonb_build_array('reproductive_health', 'mental_health'),
    'limits', jsonb_build_array('items_inside_general_sections_are_not_classified_by_purpose'),
    'patient', jsonb_build_object('id', v_prof.id, 'patient_number', v_prof.patient_number, 'full_name', v_prof.full_name,
                                  'sex', v_prof.sex::text, 'date_of_birth', v_prof.date_of_birth));

  if 'vitals' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.taken_at desc), '[]'::jsonb) into v_part from (
      select id, vital_type::text as vital_type, taken_at, source::text as source, systolic, diastolic, pulse_bpm, glucose_mmol_l,
             glucose_context::text as glucose_context, weight_kg, temperature_c, spo2_pct, waist_cm, ketones_mmol_l,
             respiratory_rate_bpm, peak_flow_l_min
        from public.vitals_readings where patient_id = p_patient order by taken_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('vitals', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'lab_results' = any (v_ok) then
    select coalesce(jsonb_agg(x.j order by x.ts desc), '[]'::jsonb) into v_part from (
      select r.released_at as ts,
             jsonb_build_object('id', i.id, 'code', i.analyte_code, 'value', i.value_numeric, 'value_text', i.value_text, 'unit', i.unit,
               'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'taken_at', r.released_at, 'origin', 'lab_result') as j
        from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
       where i.patient_id = p_patient and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null and not i.sensitive_positive
      union all
      select lr.taken_at,
             jsonb_build_object('id', lr.id, 'code', lr.code, 'value', lr.value, 'value_text', lr.value_text, 'unit', lr.unit,
               'ref_low', lr.reference_range_low, 'ref_high', lr.reference_range_high, 'flag', lr.abnormal_flag::text, 'taken_at', lr.taken_at, 'origin', 'legacy_reading')
        from public.lab_analyte_readings lr
       where lr.patient_id = p_patient and lr.report_status in ('final', 'corrected', 'amended')
      order by 1 desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('lab_results', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'medications' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_part from (
      select id, drug_name, dose, frequency, route, is_active, source::text as source, stopped_at, created_at
        from public.medications where patient_id = p_patient and superseded_at is null order by created_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('medications', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'conditions' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_part from (
      select id, condition_name, icd10_code, status::text as status, date_identified, source::text as source, created_at
        from public.patient_conditions where patient_id = p_patient order by created_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('conditions', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'allergies' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.noted_at desc), '[]'::jsonb) into v_part from (
      select id, allergen, reaction, severity::text as severity, noted_at, verification_status::text as verification_status, source::text as source
        from public.patient_allergies where patient_id = p_patient order by noted_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('allergies', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'immunizations' = any (v_ok) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.date_administered desc), '[]'::jsonb) into v_part from (
      select vr.id, vc.code as vaccine_code, vc.name as vaccine_name, vr.dose_number, vr.date_administered, vr.batch_lot_number,
             coalesce(vr.location, vr.provider) as given_where, vr.route::text as route, vr.site,
             vr.verification_status::text as verification_status
        from public.vaccination_records vr left join public.vaccination_catalog vc on vc.id = vr.vaccination_catalog_id
       where vr.profile_id = p_patient and vr.verification_status::text <> 'rejected'
       order by vr.date_administered desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('immunizations', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  if 'documents' = any (v_ok) then
    -- metadata only: never the file, its text, or a value read from a photo
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_part from (
      select id, document_type::text as document_type, document_date, mime_type, source::text as source, created_at
        from public.patient_documents where patient_id = p_patient and coalesce(ocr_state, 'pending') not in ('rejected', 'failed')
       order by created_at desc limit c_cap) x;
    v_out := v_out || jsonb_build_object('documents', v_part);
    v_n := v_n + jsonb_array_length(v_part);
  end if;

  insert into public.fhir_export_log (organisation_id, patient_id, requested_by, requester_kind, sections, refused_sections, resource_count, is_test)
  values (v_prof.organisation_id, p_patient, v_uid, v_kind, v_ok, v_refused, v_n + 1, v_prof.is_test);
  if v_kind = 'staff' then perform private.audit_chart_read(p_patient, v_ok, p_reason, 'success'); end if;

  return v_out;
end;
$$;
revoke all on function public.fhir_export_snapshot(uuid, text[], text) from public, anon;
grant execute on function public.fhir_export_snapshot(uuid, text[], text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.fhir_export_snapshot(uuid, text[], text)', 'EXECUTE') then
    raise exception 'S44 assertion: anon can run fhir_export_snapshot';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'fhir_export_log'
              and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'S44 assertion: a client role can write fhir_export_log';
  end if;
end $$;
