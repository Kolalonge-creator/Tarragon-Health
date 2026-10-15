-- S76 B6 proof: summary additions (migration *_s76_patient_summary_trend_symptom_checks_documents.sql).
--   1. A tied clinician gets readings_trend (30 day daily averages), symptom_checks (last 5, grade and date only) and
--      document_counts (counts only); still exactly ONE audit row, and its sections name the new parts.
--   2. The 30 day average is right (two same-day readings average; an older reading sits on its own day; one older than 30 days is out).
--   3. Symptom checks are capped at 5, newest first, carry only grade and checked_at, and use the clinician override when set.
--   4. An untied clinician is denied and sees none of the new keys; a patient caller and anon are refused.
--   5. No reproductive key anywhere in the answer.
--   6. SABOTAGE: with the "no readable section means denied" branch removed the untied clinician gets through.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76b6-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76B6 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S76B6 ' || p_label, 'MDCN', 'S76B6-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.summary_as(p_uid uuid, p_patient uuid, p_reason text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.clinician_patient_summary(p_patient, p_reason); exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_pat uuid; v_ver integer; i integer;
  r jsonb; v_before int; v_after int; v_day date := (now() at time zone 'Africa/Lagos')::date - 2;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkdoc(v_org, 'tied', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'untied', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other); perform pg_temp.setf('pat', v_pat);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());

  select version into v_ver from public.triage_protocols order by version limit 1;
  if v_ver is null then
    insert into public.triage_protocols (version, config, notes, is_active) values (99999, '{}'::jsonb, 'S76B6 proof draft', false);
    v_ver := 99999;
  end if;

  set local session_replication_role = replica;
  -- two readings on the same day (150/90 and 130/80 -> 140/85), one older day, one older than 30 days
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values
    (v_org, v_pat, 'blood_pressure', 150, 90, (v_day::timestamp + time '09:00') at time zone 'Africa/Lagos', 'manual'),
    (v_org, v_pat, 'blood_pressure', 130, 80, (v_day::timestamp + time '18:00') at time zone 'Africa/Lagos', 'manual'),
    (v_org, v_pat, 'blood_pressure', 120, 70, ((v_day - 10)::timestamp + time '09:00') at time zone 'Africa/Lagos', 'manual'),
    (v_org, v_pat, 'blood_pressure', 200, 120, now() - interval '45 days', 'manual');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source) values
    (v_org, v_pat, 'weight', 80.0, (v_day::timestamp + time '07:00') at time zone 'Africa/Lagos', 'manual');
  -- seven symptom checks, newest first by created_at; the newest carries a clinician override
  for i in 1..7 loop
    insert into public.symptom_triage_assessments (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture,
        category, safety_net_message_key, rationale, created_at)
      values (v_org, v_pat, 'headache', v_ver, '{}'::jsonb, case when i = 7 then 'urgent' else 'routine' end::public.triage_category,
              'k', 'S76B6 free text that must never be returned', now() - make_interval(days => 8 - i));
  end loop;
  update public.symptom_triage_assessments set override_category = 'emergency', override_reason = 'proof override of the newest check',
         overridden_by = (select id from public.clinical_staff where profile_id = v_doc), overridden_at = now()
   where patient_id = v_pat and created_at = (select max(created_at) from public.symptom_triage_assessments where patient_id = v_pat);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, original_filename, source, uploaded_by) values
    (v_org, v_pat, 'discharge_summary', 's76b6/a.pdf', 'SECRETNAME.pdf', 'patient', v_pat),
    (v_org, v_pat, 'discharge_summary', 's76b6/b.pdf', 'other.pdf', 'patient', v_pat),
    (v_org, v_pat, 'other', 's76b6/c.pdf', 'third.pdf', 'patient', v_pat);
  set local session_replication_role = origin;

  -- 1. tied clinician
  select count(*) into v_before from public.audit_log where subject_patient_id = v_pat and actor_id = v_doc and action = 'staff.chart_read';
  r := pg_temp.summary_as(v_doc, v_pat, 'Reviewing before the call');
  select count(*) into v_after from public.audit_log where subject_patient_id = v_pat and actor_id = v_doc and action = 'staff.chart_read';
  insert into results values ('real', 'tied: status ok', 'ok', r ->> 'status');
  insert into results values ('real', 'tied: one audit row', '1', (v_after - v_before)::text);
  insert into results values ('real', 'audit sections name the new parts', 'true', (exists (select 1 from public.audit_log where subject_patient_id = v_pat and actor_id = v_doc
      and event -> 'sections' ? 'readings_trend' and event -> 'sections' ? 'symptom_checks' and event -> 'sections' ? 'document_counts'))::text);
  insert into results values ('real', 'trend window is 30 days', '30', r -> 'readings_trend' ->> 'window_days');
  -- 2. averages
  insert into results values ('real', 'same-day readings average to 140/85', '140/85', (select (x ->> 'avg_systolic') || '/' || (x ->> 'avg_diastolic')
      from jsonb_array_elements(r -> 'readings_trend' -> 'rows') x where x ->> 'type' = 'bp' and (x ->> 'day')::date = v_day));
  insert into results values ('real', 'that day counts two readings', '2', (select x ->> 'n' from jsonb_array_elements(r -> 'readings_trend' -> 'rows') x where x ->> 'type' = 'bp' and (x ->> 'day')::date = v_day));
  insert into results values ('real', 'bp rows: two days only (the 45 day old reading is out)', '2', (select count(*)::text from jsonb_array_elements(r -> 'readings_trend' -> 'rows') x where x ->> 'type' = 'bp'));
  insert into results values ('real', 'weight has its own row with a value average', '80.0', (select x ->> 'avg_value' from jsonb_array_elements(r -> 'readings_trend' -> 'rows') x where x ->> 'type' = 'weight'));
  -- 3. symptom checks
  insert into results values ('real', 'symptom checks capped at 5', '5', jsonb_array_length(r -> 'symptom_checks')::text);
  insert into results values ('real', 'newest first and the override is the grade', 'emergency', r -> 'symptom_checks' -> 0 ->> 'grade');
  insert into results values ('real', 'a symptom row has only grade and checked_at', 'checked_at,grade', (select string_agg(k, ',' order by k) from jsonb_object_keys(r -> 'symptom_checks' -> 0) k));
  insert into results values ('real', 'no free text from the assessment is returned', 'false', (r::text like '%free text that must never%')::text);
  -- documents: counts only
  insert into results values ('real', 'document counts by type', 'discharge_summary:2,other:1', (select string_agg((x ->> 'document_type') || ':' || (x ->> 'count'), ',' order by x ->> 'document_type') from jsonb_array_elements(r -> 'document_counts') x));
  insert into results values ('real', 'no document name or path in the answer', 'false', (r::text like '%SECRETNAME%' or r::text like '%s76b6/%')::text);
  -- 5. no reproductive keys
  insert into results values ('real', 'no reproductive or menstrual key', 'false', (r::text ~* '(menstrual|reproductive|pregnan|fertil|contracept)')::text);

  -- 4. untied clinician, patient, anon
  r := pg_temp.summary_as(v_other, v_pat, 'Looking without a reason to');
  insert into results values ('real', 'untied clinician: denied', 'denied', r ->> 'status');
  insert into results values ('real', 'untied clinician: none of the new keys', 'false', (r ? 'readings_trend' or r ? 'symptom_checks' or r ? 'document_counts')::text);
  insert into results values ('real', 'a patient caller is refused', '42501', pg_temp.summary_as(v_pat, v_pat, 'Looking at my own record') ->> 'err');
  insert into results values ('real', 'anon cannot execute', '42501', pg_temp.try_anon(format($q$select public.clinician_patient_summary(%L, 'Reviewing before the call')$q$, v_pat)));
end $$;

-- 6. SABOTAGE
do $$
declare v_orig text; v_def text; r jsonb;
begin
  v_orig := pg_get_functiondef('public.clinician_patient_summary(uuid,text)'::regprocedure);
  v_def := replace(v_orig, 'if cardinality(v_sections) = 0 then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE not applied'; end if;
  execute v_def;
  r := pg_temp.summary_as(pg_temp.f('other'), pg_temp.f('pat'), 'Looking without a reason to');
  insert into results values ('sabotaged', 'an untied clinician is denied', 'denied', coalesce(r ->> 'status', 'got through'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 B6 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the denial branch did not let the untied clinician through'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
