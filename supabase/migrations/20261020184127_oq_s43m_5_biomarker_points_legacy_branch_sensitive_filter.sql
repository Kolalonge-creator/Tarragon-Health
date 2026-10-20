-- OQ-S43m-5: private.biomarker_points leaked sensitive positives through its legacy_report branch.
--
-- The lab_result_items branch has always excluded `i.sensitive_positive`; the lab_analyte_readings (legacy_report) branch did not,
-- although S51 (20261007002521) added lab_analyte_readings.sensitive_positive and a trigger that keeps it true for a positive HIV,
-- hepatitis B surface antigen or hepatitis C antibody result. INV-04: such a result is never shown without a clinician disclosing
-- it. public.patient_biomarker_trend / patient_biomarker_list read this function for the patient and for a caregiver holding the
-- labs_results category, so the legacy rows would have shown on the trend screen.
--
-- Live exposure on 2026-10-20: lab_analyte_readings had 0 rows, so nothing was shown. This closes it before there is data.
-- The body below is the live pg_get_functiondef (verified 2026-10-20) plus one predicate. Same signature, security definer,
-- search_path '' and ACL (no execute for public, anon or authenticated).

create or replace function private.biomarker_points(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, ref_text text, flag text, source text, laboratory text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.released_at, i.value_numeric, i.unit, i.ref_low, i.ref_high,
         case when i.ref_low is not null or i.ref_high is not null then concat_ws(' to ', i.ref_low::text, i.ref_high::text) end,
         i.flag, 'lab_result'::text, null::text
    from public.lab_result_items i
    join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null
     and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null
     and not i.sensitive_positive
  union all
  select l.taken_at, l.value, l.unit, l.reference_range_low, l.reference_range_high, l.reference_range_text, l.abnormal_flag::text, 'legacy_report'::text, l.laboratory
    from public.lab_analyte_readings l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null
     and l.report_status in ('final', 'corrected', 'amended')
     and not l.sensitive_positive
$$;
revoke all on function private.biomarker_points(uuid, text) from public, anon, authenticated;

do $$
declare v_src text; v_secdef boolean; v_cfg text[];
begin
  select p.prosrc, p.prosecdef, p.proconfig into v_src, v_secdef, v_cfg
    from pg_proc p where p.oid = 'private.biomarker_points(uuid,text)'::regprocedure;
  if v_src not like '%not l.sensitive_positive%' then raise exception 'biomarker_points legacy branch still lacks the sensitive_positive filter'; end if;
  if v_src not like '%not i.sensitive_positive%' then raise exception 'biomarker_points result-items branch lost its sensitive_positive filter'; end if;
  if not v_secdef then raise exception 'biomarker_points is no longer security definer'; end if;
  if not (v_cfg @> array['search_path=""']) then raise exception 'biomarker_points lost its empty search_path'; end if;
  if has_function_privilege('anon', 'private.biomarker_points(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.biomarker_points(uuid,text)', 'EXECUTE') then
    raise exception 'biomarker_points is executable by anon or authenticated';
  end if;
end $$;
