-- OQ-S43m-5: private.biomarker_points leaked sensitive positives through its legacy_report branch.
--
-- The lab_result_items branch has always excluded `i.sensitive_positive`; the lab_analyte_readings (legacy_report) branch did not,
-- although S51 (20261007002521) added lab_analyte_readings.sensitive_positive and a trigger that keeps it true for a positive HIV,
-- hepatitis B surface antigen or hepatitis C antibody result. INV-04: such a result is never shown without a clinician disclosing
-- it. public.patient_biomarker_trend / patient_biomarker_list read this function for the patient and for a caregiver holding the
-- labs_results category, so the legacy rows would have shown on the trend screen.
--
-- Live exposure on 2026-10-20: lab_analyte_readings had 0 rows, so nothing was shown. This closes it before there is data.
--
-- Two states exist: live reads public.lab_analyte_readings in this function, while a fresh replay has it moved to the
-- private.lab_analyte_readings_current view by 20261014173212 (and packages/db/tests/s05b_c_read_filters_and_guards.sql fails any definer function
-- that reads the base table again). So this migration (1) appends sensitive_positive to that view, so both forms can filter on it, and
-- (2) patches the function in place from its definition at apply time, by anchor, instead of re-creating it from the live text.
-- Same signature, security definer, search_path '' and ACL (no execute for public, anon or authenticated).

do $v$
declare v_def text; v_new text;
begin
  v_def := pg_get_viewdef('private.lab_analyte_readings_current'::regclass);
  if v_def !~* 'sensitive_positive' then
    v_new := regexp_replace(v_def, '\s+FROM\s+', E',\n    sensitive_positive\n   FROM ', 'i');
    if v_new = v_def then raise exception 'lab_analyte_readings_current: could not append sensitive_positive'; end if;
    execute 'create or replace view private.lab_analyte_readings_current as ' || v_new;
  end if;
end $v$;

do $p$
declare
  v_anchor constant text := $a$and l.report_status in ('final', 'corrected', 'amended')$a$;
  v_add constant text := $b$ and not l.sensitive_positive$b$;
  v_oid oid; v_def text; v_n integer := 0;
begin
  for v_oid in select p.oid from pg_proc p where p.proname = 'biomarker_points' and p.pronamespace = 'private'::regnamespace loop
    v_def := pg_get_functiondef(v_oid);
    if position(v_anchor || v_add in v_def) > 0 then v_n := v_n + 1; continue; end if;
    if (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) then
      raise exception 'biomarker_points (%): the anchor is missing or repeated, refusing to guess', v_oid::regprocedure;
    end if;
    execute replace(v_def, v_anchor, v_anchor || v_add);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'biomarker_points not found'; end if;
end $p$;
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
  if not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'lab_analyte_readings_current' and column_name = 'sensitive_positive') then
    raise exception 'lab_analyte_readings_current lacks sensitive_positive';
  end if;
end $$;
