-- Tarragon Health 2.0, Phase 1 (decision T2-04): a result filed from an uploaded lab report now reaches the same abnormal-result
-- engine as a result a clinician records by hand.
--
-- The gap, read from the live definitions on 2026-11-04: public.confirm_lab_report_extraction files the values a clinician
-- confirms into lab_analyte_readings and stops there. It never fills reference_range_* or abnormal_flag (those columns arrived in
-- 20260827203536 and the RPC was never redefined), and it writes no screening_results row, so private.handle_abnormal_screening_result
-- (the Category 2 -> 1 upgrade, the clinician_alerts row on the signed escalation_slas, the abnormal-result-handler page) never runs
-- for an uploaded report. The only automatic alert on a filed value was the eGFR/ACR kidney trigger. A doctor had to author any
-- abnormal finding by hand, which is exactly the "never let it fail silently" case CLAUDE.md names.
--
-- What this adds, reusing what is already signed rather than adding anything that needs a new signature:
--   1. private.classify_filed_lab_value: one reading against the active membership_annual panel (ranges and critical limits signed,
--      lab_panel_signoffs v5 approved 2026-10-30) through the existing private.classify_lab_result. It returns null, never "normal",
--      when the panel is not signed, the test is not on the panel, the unit is not the panel's unit, or a qualitative answer is not
--      recognised. "Reactive" / "non-reactive" are read as positive / negative.
--   2. BEFORE INSERT on lab_analyte_readings: when the writer stored no range and no flag, the signed range and flag are filled in,
--      labelled range_source = 'cmo_signed_config' with the panel version as the reference. A writer's own range is never replaced.
--      The range printed on the lab report is kept where it already lives (lab_report_extractions.rows / lab_extraction_corrections
--      .printed_range) and is quoted in the result summary below, so the lab's interval and Tarragon's sit side by side.
--   3. AFTER UPDATE on lab_report_extractions, when a filing completes (status -> 'confirmed'): the values just filed are classified,
--      grouped by screen type (kidney, lipids, liver, blood count, glucose, HbA1c, HIV, hepatitis B, hepatitis C), and one
--      screening_results row is written per group that has an out-of-range, critical or positive value. The existing triggers on
--      screening_results then do everything they already do for a hand-recorded result: the screening upgrade, the clinician alert
--      on escalation_slas pathway screening_abnormal_result (signed v9: 12 hours critical, 24 hours abnormal), the page, the care-plan
--      review, the timeline. HIV and hepatitis results carry their own screen type, so the 'restricted' release mode keeps a positive
--      result away from the patient until a clinician discloses it.
--
-- Deliberately not done here:
--   * no new SLA pathway and no feature guard: the alert is the screening pathway the CMO already signed, and clinical_operations_enabled
--     (on) is the master over it (G-01: one gate per feature, no guard where a master gates it);
--   * a value that cannot be classified raises nothing new: the filing clinician has the report open from the clinician_review alert
--     the upload already raised (private.handle_lab_result_document), so it is already in front of a doctor;
--   * anti-HBs is not alerted: a positive result means immunity, and the panel already holds every anti-HBs result for a clinician;
--   * the S27 structured path (lab_result_items -> clinical tasks) and the patient's own confirmed values (patient_reported_lab_values,
--     never clinical) are unchanged; joining S27 to the same engine is the next piece of Phase 1;
--   * a failure to write the screening row is not swallowed: the filing fails and the clinician sees the error, rather than the value
--     being filed with no alert.
--
-- Rows affected at the time of writing: lab_result_documents 0, lab_analyte_readings 0 in production, so nothing to backfill.

-- 1. which screen type a yearly-panel test belongs to (null: not alerted from here)
create or replace function private.yearly_panel_screen_type(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_code, '')))
    when 'fasting_glucose' then 'ogtt_fpg'
    when 'hba1c' then 'hba1c'
    when 'creatinine' then 'kft'
    when 'potassium' then 'kft'
    when 'sodium' then 'kft'
    when 'total_cholesterol' then 'lipid_panel'
    when 'ldl_cholesterol' then 'lipid_panel'
    when 'hdl_cholesterol' then 'lipid_panel'
    when 'triglycerides' then 'lipid_panel'
    when 'alt' then 'lft'
    when 'ast' then 'lft'
    when 'haemoglobin' then 'fbc'
    when 'wbc' then 'fbc'
    when 'platelets' then 'fbc'
    when 'hiv_screen' then 'hiv'
    when 'hbsag' then 'hep_b'
    when 'hcv_ab' then 'hep_c'
    else null
  end
$$;

-- 1b. the name a patient reads for a yearly-panel test (matches packages/shared/src/yearly-panel-tests.ts)
create or replace function private.yearly_panel_test_label(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_code, '')))
    when 'fasting_glucose' then 'Fasting glucose'
    when 'hba1c' then 'HbA1c'
    when 'creatinine' then 'Creatinine'
    when 'potassium' then 'Potassium'
    when 'sodium' then 'Sodium'
    when 'total_cholesterol' then 'Total cholesterol'
    when 'ldl_cholesterol' then 'LDL cholesterol'
    when 'hdl_cholesterol' then 'HDL cholesterol'
    when 'triglycerides' then 'Triglycerides'
    when 'alt' then 'ALT'
    when 'ast' then 'AST'
    when 'haemoglobin' then 'Haemoglobin'
    when 'wbc' then 'White cell count'
    when 'platelets' then 'Platelets'
    when 'hiv_screen' then 'HIV screen'
    when 'hbsag' then 'Hepatitis B surface antigen'
    when 'hcv_ab' then 'Hepatitis C antibody'
    else replace(lower(btrim(coalesce(p_code, ''))), '_', ' ')
  end
$$;

-- 2. one filed value against the signed panel
create or replace function private.classify_filed_lab_value(
  p_patient uuid, p_code text, p_value numeric, p_value_text text, p_unit text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_panel uuid;
  v_ref text;
  v_def jsonb;
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
  v_txt text;
  v_item jsonb;
begin
  if not private.lab_panels_signed() then return null; end if;

  select v.id, 'lab_panel_versions:' || v.panel_code || ':v' || v.version
    into v_panel, v_ref
    from public.lab_panel_versions v
   where v.panel_code = 'membership_annual' and v.is_active
   limit 1;
  if v_panel is null then return null; end if;

  select a into v_def
    from public.lab_panel_versions v, jsonb_array_elements(v.analytes) a
   where v.id = v_panel and a ->> 'code' = v_code;
  if v_def is null then return null; end if;

  begin
    if v_def ->> 'kind' = 'numeric' then
      if p_value is null then return null; end if;
      if lower(v_unit) = 'percent' then v_unit := '%'; end if;
      -- units compare without case ("mmol/l" is "mmol/L"); anything else is not converted here, it is "cannot classify"
      if lower(v_unit) is distinct from lower(v_def ->> 'unit') then return null; end if;
      v_unit := v_def ->> 'unit';
      v_item := private.classify_lab_result(v_panel,
        jsonb_build_array(jsonb_build_object('analyte_code', v_code, 'value_numeric', p_value, 'unit', v_unit)), p_patient) -> 'items' -> 0;
    else
      v_txt := lower(btrim(coalesce(p_value_text, '')));
      v_txt := case
        when v_txt in ('positive', 'reactive', 'detected') then 'positive'
        when v_txt in ('negative', 'non-reactive', 'non reactive', 'nonreactive', 'not detected') then 'negative'
        else null end;
      if v_txt is null then return null; end if;
      v_item := private.classify_lab_result(v_panel,
        jsonb_build_array(jsonb_build_object('analyte_code', v_code, 'value_text', v_txt)), p_patient) -> 'items' -> 0;
    end if;
  exception when others then
    -- classify_lab_result refuses an out-of-bounds or unrecognised value with an exception; that is "cannot classify", not normal
    return null;
  end;

  if v_item is null then return null; end if;
  return jsonb_build_object(
    'flag', case
      when v_item ->> 'flag' = 'critical' and (v_item ->> 'ref_low') is not null and p_value < (v_item ->> 'ref_low')::numeric then 'critical_low'
      when v_item ->> 'flag' = 'critical' then 'critical_high'
      else v_item ->> 'flag' end,
    'kind', v_def ->> 'kind',
    'unit', v_def ->> 'unit',
    'ref_low', v_item -> 'ref_low',
    'ref_high', v_item -> 'ref_high',
    'panel_ref', v_ref);
end;
$$;

comment on function private.classify_filed_lab_value(uuid, text, numeric, text, text) is
  'T2-04: one filed lab value against the active, CMO-signed membership_annual panel. Returns {flag, kind, unit, ref_low, ref_high, panel_ref}, or null when it cannot be classified (panel unsigned, test not on the panel, unit differs, answer not recognised). Null is never normal.';

-- 3. fill the signed range on a reading that arrived with none
create or replace function private.lab_reading_fill_signed_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c jsonb;
begin
  if new.range_source <> 'unspecified' or new.abnormal_flag is not null
     or new.reference_range_low is not null or new.reference_range_high is not null or new.reference_range_text is not null then
    return new;
  end if;

  v_c := private.classify_filed_lab_value(new.patient_id, new.code, new.value, new.value_text, new.unit);
  if v_c is null then return new; end if;

  if v_c ->> 'kind' = 'numeric' then
    new.reference_range_low := (v_c ->> 'ref_low')::numeric;
    new.reference_range_high := (v_c ->> 'ref_high')::numeric;
    new.abnormal_flag := (v_c ->> 'flag')::public.lab_analyte_flag;
    if new.reference_range_low is null and new.reference_range_high is null then
      -- a panel test with only critical limits (none today): keep the flag, store no range, so the source stays honest
      return new;
    end if;
  else
    -- lab_analyte_flag has no positive/negative values; the range is recorded and the flag stays not evaluated
    new.reference_range_text := 'Negative';
  end if;
  new.range_source := 'cmo_signed_config';
  new.range_source_ref := v_c ->> 'panel_ref';
  return new;
end;
$$;

drop trigger if exists lab_reading_fill_signed_range on public.lab_analyte_readings;
create trigger lab_reading_fill_signed_range
  before insert on public.lab_analyte_readings
  for each row execute function private.lab_reading_fill_signed_range();

-- 4. a completed filing raises the abnormal-result engine, one screening row per screen type with something abnormal
create or replace function private.raise_abnormal_results_from_filed_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken_at timestamptz;
  g record;
  r record;
  v_c jsonb;
  v_flag text;
  v_lines text[];
  v_codes text[];
  v_critical boolean;
  v_printed text;
  v_value text;
  v_hint text;
  v_panel_ref text;
  v_raised integer := 0;
  v_unclassified text[] := '{}';
begin
  if new.status is distinct from 'confirmed' or old.status = 'confirmed' or new.report_date is null then
    return new;
  end if;
  -- the same midday-UTC instant confirm_lab_report_extraction stamps on every reading it files
  v_taken_at := (new.report_date::text || ' 12:00:00+00')::timestamptz;

  for g in
    select private.yearly_panel_screen_type(l.code) as screen_type
      from private.lab_analyte_readings_current l
     where l.patient_id = new.patient_id
       and l.created_at = now()            -- filed in this transaction, by this confirmation
       and l.taken_at = v_taken_at
       and l.code in (select jsonb_array_elements_text(coalesce(new.confirmed_codes, '[]'::jsonb)))
     group by 1
  loop
    v_lines := '{}'; v_codes := '{}'; v_critical := false;

    for r in
      select l.code, l.value, l.value_text, l.unit
        from private.lab_analyte_readings_current l
       where l.patient_id = new.patient_id
         and l.created_at = now()
         and l.taken_at = v_taken_at
           and l.code in (select jsonb_array_elements_text(coalesce(new.confirmed_codes, '[]'::jsonb)))
         and private.yearly_panel_screen_type(l.code) is not distinct from g.screen_type
       order by l.code
    loop
      v_c := private.classify_filed_lab_value(new.patient_id, r.code, r.value, r.value_text, r.unit);
      if v_c is null then
        v_unclassified := v_unclassified || r.code;
        -- a yearly-panel test that cannot be checked (an answer like "Weakly reactive", an unexpected unit) is not normal: it goes to a
        -- doctor on the same pathway. With the panel unsigned nothing is classified at all, so nothing is raised from here either.
        if g.screen_type is null or not private.lab_panels_signed() then continue; end if;
        v_codes := v_codes || lower(r.code);
        v_lines := v_lines || format('%s %s: could not be checked automatically, a doctor will review it',
          private.yearly_panel_test_label(r.code), coalesce(trim_scale(r.value)::text || coalesce(' ' || r.unit, ''), r.value_text, 'no value'));
        continue;
      end if;
      v_flag := v_c ->> 'flag';
      v_panel_ref := v_c ->> 'panel_ref';
      if v_flag in ('normal', 'negative') or g.screen_type is null then
        continue;
      end if;

      v_codes := v_codes || lower(r.code);
      if v_flag in ('critical_low', 'critical_high') then v_critical := true; end if;
      select x ->> 'reportedRange' into v_printed
        from jsonb_array_elements(coalesce(new.rows, '[]'::jsonb)) x
       where lower(x ->> 'code') = lower(r.code)
       limit 1;
      v_value := coalesce(trim_scale(r.value)::text || coalesce(' ' || r.unit, ''), r.value_text);
      v_lines := v_lines || format('%s %s: %s%s%s',
        private.yearly_panel_test_label(r.code), v_value,
        case v_flag when 'critical_low' then 'very low' when 'critical_high' then 'very high' else v_flag end,
        case when v_c ->> 'kind' = 'numeric'
             then format(' (our range %s to %s %s)', coalesce(v_c ->> 'ref_low', '-'), coalesce(v_c ->> 'ref_high', '-'), v_c ->> 'unit')
             else '' end,
        case when nullif(btrim(v_printed), '') is not null then format('; range on the report: %s', v_printed) else '' end);
    end loop;

    if coalesce(array_length(v_codes, 1), 0) = 0 then
      continue;
    end if;

    -- the condition hint private.handle_abnormal_screening_result reads (hba1c is already a code). Sensitivity comes from the screen
    -- type (screen_types.sensitive for hiv, hep_b, hep_c), so no extra sensitive word is put into the flags.
    v_hint := case g.screen_type when 'ogtt_fpg' then 'glucose' else null end;

    insert into public.screening_results
      (organisation_id, patient_id, result_status, result_summary, abnormal_flags, screen_type_code, laboratory)
    values (
      new.organisation_id,
      new.patient_id,
      case when v_critical then 'critical' else 'abnormal' end::public.result_status,
      format('From an uploaded lab report filed by the care team (report date %s). %s.',
             to_char(new.report_date, 'DD Mon YYYY'), array_to_string(v_lines, '; ')),
      case when v_hint is null then v_codes else v_codes || v_hint end,
      g.screen_type,
      new.lab_name
    );
    v_raised := v_raised + 1;
  end loop;

  perform private.log_audit('lab_upload.filed_results_classified', 'lab_report_extractions', new.id,
    jsonb_build_object('screening_results_raised', v_raised, 'not_classified', to_jsonb(v_unclassified), 'panel', v_panel_ref));
  return new;
end;
$$;

drop trigger if exists lab_report_extraction_raise_abnormal on public.lab_report_extractions;
create trigger lab_report_extraction_raise_abnormal
  after update of status on public.lab_report_extractions
  for each row execute function private.raise_abnormal_results_from_filed_upload();

-- 5. health-education recommendations are patient-visible and are chosen from abnormal_flags; a sensitive result (HIV, hepatitis,
-- PSA, cervical...) must not produce one, or the recommendation itself would tell the patient (or a caregiver) the result before a
-- clinician discloses it. No mapping matches a sensitive flag today, so this closes a latent leak for every result source, not only
-- this one. Body otherwise as live on 2026-11-04.
create or replace function private.health_education_recommend_on_abnormal_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text;
  v_content record;
begin
  if new.abnormal_flags is null or array_length(new.abnormal_flags, 1) is null then
    return new;
  end if;
  if new.screen_type_code is not null
     and exists (select 1 from public.screen_types st where st.code = new.screen_type_code and st.sensitive) then
    return new;
  end if;

  foreach v_flag in array new.abnormal_flags loop
    if private.is_sensitive_analyte_code(v_flag) then
      continue;
    end if;
    for v_content in
      select distinct c.id
      from public.health_education_trigger_mappings tm
      join public.health_education_content c
        on private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
        and (tm.target_content_id is null or c.id = tm.target_content_id)
        and (tm.target_category is null or c.category = tm.target_category)
        and (tm.target_condition is null or c.condition = tm.target_condition or c.condition is null)
      where tm.is_active
        and tm.trigger_source = 'abnormal_result'
        and lower(v_flag) like '%' || lower(tm.match_key) || '%'
    loop
      insert into public.health_education_recommendations (organisation_id, patient_id, content_id, trigger_reason)
      values (new.organisation_id, new.patient_id, v_content.id, format('Abnormal result: %s', v_flag));
    end loop;
  end loop;

  return new;
end;
$$;

revoke all on function private.yearly_panel_test_label(text) from public, anon, authenticated;
revoke all on function private.yearly_panel_screen_type(text) from public, anon, authenticated;
revoke all on function private.classify_filed_lab_value(uuid, text, numeric, text, text) from public, anon, authenticated;
revoke all on function private.lab_reading_fill_signed_range() from public, anon, authenticated;
revoke all on function private.raise_abnormal_results_from_filed_upload() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'lab_reading_fill_signed_range' and tgrelid = 'public.lab_analyte_readings'::regclass) then
    raise exception 'FAIL: lab_reading_fill_signed_range trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'lab_report_extraction_raise_abnormal' and tgrelid = 'public.lab_report_extractions'::regclass) then
    raise exception 'FAIL: lab_report_extraction_raise_abnormal trigger missing';
  end if;
  if has_function_privilege('anon', 'private.classify_filed_lab_value(uuid, text, numeric, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.classify_filed_lab_value(uuid, text, numeric, text, text)', 'EXECUTE') then
    raise exception 'FAIL: classify_filed_lab_value is executable by a client role';
  end if;
  if private.yearly_panel_screen_type('HbA1c') <> 'hba1c' or private.yearly_panel_screen_type('anti_hbs') is not null then
    raise exception 'FAIL: yearly_panel_screen_type mapping';
  end if;
  raise notice 'PASS: t2 filed upload results join the abnormal-result engine';
end $$;
