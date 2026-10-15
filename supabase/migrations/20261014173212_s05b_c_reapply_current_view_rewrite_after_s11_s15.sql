-- Re-applies the S05b-c definer-reader rewrite to functions that the S11 to S15 migrations (re)defined after it.
--
-- WHY. S05b-c (20261013235037) rewrote every SECURITY DEFINER reader of vitals_readings, patient_allergies, patient_conditions and
-- lab_analyte_readings to read private.<table>_current (the view that hides superseded and entered-in-error rows). It did that once, at its own
-- position in the migration order. Several S11 to S15 migrations were written before S05b-c landed and carry timestamps before it; a replay of
-- them in order is rewritten correctly, but on a database that already had S05b-c applied they run AFTER it and bring back a body that reads the
-- base table (create or replace of an existing function: the old text wins). This migration repeats the same rewrite, idempotently, so the
-- order of application no longer matters. On a fresh replay it patches nothing.
--
-- Writers are never touched (they must see the base row): the same listed exceptions as S05b-c, plus public.record_glucose_triage_result,
-- which writes triage_event_id on the glucose reading it graded. A function that both reads and writes a corrected table and is not listed
-- is reported with a warning and left as it is (the S05b-c proof then names it).
do $$
declare
  r record;
  v_def text;
  v_new text;
  v_t text;
  v_patched int := 0;
  v_skip constant text[] := array[
    'correct_clinical_value', 'delete_wearable_connection_data', 'execute_wearable_data_deletion', 'clear_vitals_validation_flag',
    'record_triage_result', 'record_glucose_triage_result', 'record_poc_measurements', 'confirm_lab_report_extraction',
    'enforce_fhir_import_resource_attribution', 'capture_record_correction', 'handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag',
    'handle_spo2_reading_red_flag', 'handle_temperature_reading_red_flag', 'enforce_htn_alert_attestation'];
begin
  for r in
    select p.oid, n.nspname, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosecdef
       and not (p.proname = any (v_skip))
       and p.prosrc ~* '(from|join)\s+public\.(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
  loop
    if (select p.prosrc from pg_proc p where p.oid = r.oid) ~* '(insert\s+into|update|delete\s+from)\s+public\.(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
       or (select p.prosrc from pg_proc p where p.oid = r.oid) ~* '(public\.)?\m(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\.[a-z_*]' then
      raise warning 's05b_c reapply: %.% reads and writes a corrected table and is not listed: left as it is', r.nspname, r.proname;
      continue;
    end if;
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    foreach v_t in array array['vitals_readings', 'patient_allergies', 'patient_conditions', 'lab_analyte_readings'] loop
      v_new := regexp_replace(v_new, '(from|join)(\s+)public\.' || v_t || '\M', '\1\2private.' || v_t || '_current', 'gi');
    end loop;
    if v_new <> v_def then
      execute v_new;
      v_patched := v_patched + 1;
    end if;
  end loop;
  raise notice 's05b_c reapply: % definer readers moved to the *_current views', v_patched;
end $$;
