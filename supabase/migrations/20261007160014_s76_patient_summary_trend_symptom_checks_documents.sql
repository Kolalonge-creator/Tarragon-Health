-- S76 B6 (23.4): three additions to public.clinician_patient_summary(uuid, text). Same signature, same grants, same
-- guards, same single audit row; only the answer grows. The live definition (S35 care circle guard) is patched in place
-- with three anchored replacements so nothing else about it can drift.
--
--   * readings_trend (inside the vitals section, same category gate as readings): daily averages (Lagos day) for the last
--     30 days per vital type, with the count behind each average. Blood pressure gives average systolic and diastolic.
--   * symptom_checks (medical_history gate, the category the table's own policy uses): the last 5 symptom checks with the
--     grade (the clinician's override when there is one) and the date. No complaint, no answers, no free text.
--   * document_counts (medical_history gate): how many documents of each type the patient has on file. Counts only; never
--     a name, a path or a document.
--   NOT added: menstrual, pregnancy, fertility or any reproductive data (vital types here are vitals only; the symptom
--   rows carry grade and date alone). NOT added: assistant interactions (needs a governed read design; see the report).
-- Each new section is listed in the audit row's sections, so the INV-10 record says what was opened.

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.clinician_patient_summary(uuid, text)'::regprocedure) into v_def;
  v_new := v_def;

  v_new := replace(v_new,
    E'    v_sections := v_sections || ''triage_events''::text;',
    E'    v_sections := v_sections || ''readings_trend''::text;\n' ||
    E'    v_out := v_out || jsonb_build_object(''readings_trend'', jsonb_build_object(\n' ||
    E'      ''window_days'', 30,\n' ||
    E'      ''rows'', coalesce((select jsonb_agg(to_jsonb(d) order by d.day, d.type) from (\n' ||
    E'          select (o.measured_at at time zone ''Africa/Lagos'')::date as day, o.type,\n' ||
    E'                 round(avg(o.systolic))::integer as avg_systolic, round(avg(o.diastolic))::integer as avg_diastolic,\n' ||
    E'                 round(avg(o.value_numeric), 1) as avg_value, count(*)::integer as n\n' ||
    E'            from public.observations o\n' ||
    E'           where o.patient_id = p_patient and o.measured_at >= now() - interval ''30 days''\n' ||
    E'           group by 1, 2) d), ''[]''::jsonb)));\n' ||
    E'    v_sections := v_sections || ''triage_events''::text;');

  v_new := replace(v_new,
    E'  else\n    v_denied := v_denied || array[''allergies'',''conditions''];',
    E'    v_sections := v_sections || array[''symptom_checks'',''document_counts''];\n' ||
    E'    v_out := v_out || jsonb_build_object(\n' ||
    E'      ''symptom_checks'', coalesce((select jsonb_agg(to_jsonb(s) order by s.checked_at desc) from (\n' ||
    E'          select coalesce(a.override_category, a.category)::text as grade, a.created_at as checked_at\n' ||
    E'            from public.symptom_triage_assessments a\n' ||
    E'           where a.patient_id = p_patient order by a.created_at desc limit 5) s), ''[]''::jsonb),\n' ||
    E'      ''document_counts'', coalesce((select jsonb_agg(jsonb_build_object(''document_type'', x.document_type, ''count'', x.n) order by x.document_type)\n' ||
    E'          from (select pd.document_type::text as document_type, count(*)::integer as n\n' ||
    E'                  from public.patient_documents pd where pd.patient_id = p_patient group by 1) x), ''[]''::jsonb));\n' ||
    E'  else\n    v_denied := v_denied || array[''allergies'',''conditions''];');

  if v_new = v_def or position('readings_trend' in v_new) = 0 or position('symptom_checks' in v_new) = 0 then
    raise exception 'clinician_patient_summary did not have the expected text to replace';
  end if;
  -- each anchor must have been used exactly once
  if (length(v_new) - length(replace(v_new, '''readings_trend''::text', ''))) / length('''readings_trend''::text') <> 1 then
    raise exception 'readings_trend anchor applied more than once'; end if;
  execute v_new;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE') then raise exception 'S76 B6: anon can execute the summary'; end if;
  if not has_function_privilege('authenticated', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE') then raise exception 'S76 B6: authenticated lost execute'; end if;
  if position('s35_audit_read' in pg_get_functiondef('public.clinician_patient_summary(uuid,text)'::regprocedure)) = 0 then raise exception 'S76 B6: the audit call was lost'; end if;
  if position('menstrual' in lower(pg_get_functiondef('public.clinician_patient_summary(uuid,text)'::regprocedure))) > 0
     or position('reproductive' in lower(pg_get_functiondef('public.clinician_patient_summary(uuid,text)'::regprocedure))) > 0 then
    raise exception 'S76 B6: reproductive data must not appear in the summary'; end if;
end $$;
