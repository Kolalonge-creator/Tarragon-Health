-- Tarragon Health — confirm_ecg_report_extraction RPC + ECG naming fix
--
-- Part 1 mirrors public.confirm_lab_report_extraction
-- (20260807151847_nigerian_lab_ingestion_engine.sql:383-540): a clinician's
-- confirmation of drafted ECG parameters, filed in one transaction so
-- confirmed_by is derived from the caller's own active clinical_staff row,
-- never client-supplied, and two review tabs can't both file the same draft.
-- No template-learning/corrections corpus for v1 (that is the lab pipeline's
-- lab_report_templates/lab_extraction_corrections — worth adding later if
-- extraction accuracy across device/cart brands turns out to vary; not needed
-- to ship parameter extraction itself).
--
-- DELIBERATELY DOES NOT record a screening_results row or touch the
-- abnormal-result pipeline, and DELIBERATELY DOES NOT decide anything is
-- clinically critical (no raise_*_alert call here, unlike the lab pipeline's
-- raise_lab_extraction_alert on a critical lab value) — filing parameters and
-- the clinician's own procedural_status judgement on the ecg_resting
-- screening_results row stay two separate, both-required acts.
--
-- Part 2 fixes a real, pre-existing naming gap found while building this: the
-- per-provider lab_tests price-list row for ecg_resting was seeded (in
-- 20260802212103_screening_ladder_core_advanced_comprehensive.sql) as "Resting
-- ECG", missing the lead count, while the canonical screen_types.name for the
-- same code already correctly says "Resting 12-Lead ECG". A patient reading
-- this price-list label had no reason to know a single-lead ECG isn't what's
-- wanted. Corrected to match, for the same reason apps/web/src/lib/labs/
-- test-code-labels.ts's patient-facing label is corrected in the same PR.

create or replace function public.confirm_ecg_report_extraction(
  p_extraction_id uuid,
  p_readings jsonb,
  p_report_date date
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.ecg_report_extractions%rowtype;
  v_staff_id uuid;
  v_reading jsonb;
  v_taken_at timestamptz;
  v_code text;
  v_value numeric;
  v_value_text text;
  v_unit text;
  v_filed integer := 0;
  v_codes text[] := '{}';
begin
  select * into v_row from public.ecg_report_extractions where id = p_extraction_id;
  if v_row.id is null then
    raise exception 'Extraction not found' using errcode = '42501';
  end if;

  select cs.id into v_staff_id
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_row.organisation_id
    and cs.active;
  if v_staff_id is null then
    raise exception 'Only an active care-team clinician can file an extracted ECG'
      using errcode = '42501';
  end if;

  if v_row.status = 'confirmed' then
    raise exception 'These parameters have already been filed' using errcode = '23505';
  end if;
  if v_row.status = 'failed' then
    raise exception 'This ECG could not be read, so there is nothing to file'
      using errcode = '22023';
  end if;

  -- Midday UTC so a timezone shift can never move a reading across a day
  -- boundary and reorder a trend.
  v_taken_at := (p_report_date::text || ' 12:00:00+00')::timestamptz;

  for v_reading in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb))
  loop
    v_code := v_reading->>'code';
    v_value := nullif(v_reading->>'value', '')::numeric;
    v_value_text := nullif(v_reading->>'value_text', '');
    v_unit := nullif(v_reading->>'unit', '');

    if v_code is null or (v_value is null and v_value_text is null) then
      raise exception 'Each parameter needs a code and either a value or a value_text'
        using errcode = '22023';
    end if;
    if v_value is not null and v_unit is null then
      raise exception 'A numeric parameter needs a unit' using errcode = '22023';
    end if;

    insert into public.ecg_parameter_readings
      (organisation_id, patient_id, ecg_report_document_id, code, value, value_text, unit,
       taken_at, confirmed_by, confirmed_at)
    values (
      v_row.organisation_id,
      v_row.patient_id,
      v_row.document_id,
      v_code,
      v_value,
      v_value_text,
      case when v_value is not null then v_unit else null end,
      v_taken_at,
      (select auth.uid()),
      now()
    );

    v_codes := v_codes || v_code;
    v_filed := v_filed + 1;
  end loop;

  update public.ecg_report_extractions
     set status = 'confirmed',
         confirmed_by = (select auth.uid()),
         confirmed_at = now(),
         confirmed_codes = to_jsonb(v_codes),
         report_date = p_report_date
   where id = p_extraction_id;

  return v_filed;
end;
$function$;

revoke all on function public.confirm_ecg_report_extraction(uuid, jsonb, date) from public;
revoke all on function public.confirm_ecg_report_extraction(uuid, jsonb, date) from anon;
revoke all on function public.confirm_ecg_report_extraction(uuid, jsonb, date) from public, anon;
grant execute on function public.confirm_ecg_report_extraction(uuid, jsonb, date) to authenticated;

-- ---------------------------------------------------------------------------
-- ECG naming fix — see header
-- ---------------------------------------------------------------------------
update public.lab_tests
   set name = 'Resting 12-Lead ECG'
 where code = 'ecg_resting'
   and name <> 'Resting 12-Lead ECG';

-- ---------------------------------------------------------------------------
-- Self-verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_stale_lab_tests integer;
begin
  if has_function_privilege('anon', 'public.confirm_ecg_report_extraction(uuid,jsonb,date)', 'EXECUTE') then
    raise exception 'confirm_ecg_report_extraction: anon must not be able to execute this';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_ecg_report_extraction(uuid,jsonb,date)', 'EXECUTE') then
    raise exception 'confirm_ecg_report_extraction: authenticated grant did not take';
  end if;

  select count(*) into v_stale_lab_tests
  from public.lab_tests
  where code = 'ecg_resting' and name <> 'Resting 12-Lead ECG';
  if v_stale_lab_tests > 0 then
    raise exception 'lab_tests: % ecg_resting row(s) still not renamed to Resting 12-Lead ECG', v_stale_lab_tests;
  end if;
end $$;
