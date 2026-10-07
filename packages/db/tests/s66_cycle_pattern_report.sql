-- ===========================================================================
-- Proof: S66 clinician cycle pattern report (INV-10, INV-12, INV-14; reproductive_health category rules).
-- Simulated sessions for: the patient (refused on the staff path), a caregiver with 'manage' AND an explicit reproductive_health grant,
-- a sponsor (hmo_admin), an employer (corporate_admin), a pharmacist, an admin, a care coordinator who is on the patient's care team,
-- an UNRELATED clinician, a clinician of ANOTHER organisation, and the TIED clinician.
--   * only the tied clinician reads; every other staff caller gets 'denied' and the refusal is audited; non-staff roles are denied too;
--   * the report carries no notes, no temperature, no ovulation result; the menopause log rides along without its notes;
--   * the go-live guard: with the guard OFF and a real (non test) patient the function raises 55000 and writes nothing; a test pair passes;
--   * every success and refusal writes one audit_log row; the patient sees them, with the reader's name, through my_reproductive_access_log
--     and another patient sees none; anon cannot execute either function; sponsor and employer cannot read the cycle tables directly.
-- SABOTAGE: private.reproductive_staff_tied is replaced by "any signed-in user"; an untied clinician must then be admitted (the check is real).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures; test accounts only.
-- ===========================================================================
begin;

do $$
declare
  v_org uuid; v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid(); v_pat2 uuid := gen_random_uuid(); v_cg uuid := gen_random_uuid(); v_sp uuid := gen_random_uuid(); v_emp uuid := gen_random_uuid();
  v_ph uuid := gen_random_uuid(); v_adm uuid := gen_random_uuid(); v_cc uuid := gen_random_uuid(); v_untied uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_tied uuid := gen_random_uuid(); v_pa uuid;
  v_json jsonb; v_n integer; v_audits integer; v_failed boolean; v_who uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S66B Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, 's66b-' || substr(x::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_pat2, v_cg, v_sp, v_emp, v_ph, v_adm, v_cc, v_untied, v_other, v_tied]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values
    (v_pat, v_org, 'patient', 'S66B Patient', '+2348066100001', true), (v_pat2, v_org, 'patient', 'S66B Patient Two', '+2348066100002', true),
    (v_cg, v_org, 'patient', 'S66B Caregiver', '+2348066100003', true), (v_sp, v_org, 'hmo_admin', 'S66B Sponsor', '+2348066100004', true),
    (v_emp, v_org, 'corporate_admin', 'S66B Employer', '+2348066100005', true), (v_ph, v_org, 'pharmacist', 'S66B Pharmacist', '+2348066100006', true),
    (v_adm, v_org, 'admin', 'S66B Admin', '+2348066100007', true), (v_cc, v_org, 'care_coordinator', 'S66B Coordinator', '+2348066100008', true),
    (v_untied, v_org, 'clinician', 'S66B Untied Doctor', '+2348066100009', true), (v_other, v_org2, 'clinician', 'S66B Other Org Doctor', '+2348066100010', true),
    (v_tied, v_org, 'clinician', 'S66B Tied Doctor', '+2348066100011', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_test = true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied, 'S66B Tied Doctor', true, now(), 'senior_medical_officer'), (v_org, v_untied, 'S66B Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org2, v_other, 'S66B Other Org Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pat, v_tied, v_cc, now())
  on conflict (patient_id) do update set clinician_id = v_tied, care_coordinator_id = v_cc;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_cg, 'manage', v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'reproductive_health');
  perform set_config('request.jwt.claims', null, true);

  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, v_pat, 'menstruating');
  insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date, period_end_date, notes) values
    (v_org, v_pat, current_date - 60, current_date - 56, 'S66B-NOTE-CYCLE'), (v_org, v_pat, current_date - 32, current_date - 28, null), (v_org, v_pat, current_date - 4, null, null);
  insert into public.menstrual_daily_logs (organisation_id, patient_id, log_date, flow, symptoms, moods, notes, basal_body_temperature_c, ovulation_test_result) values
    (v_org, v_pat, current_date - 3, 'heavy', array['cramps']::public.menstrual_symptom[], array['low']::public.menstrual_mood[], 'S66B-NOTE-DAY', 36.71, 'positive');
  insert into public.menopause_symptom_logs (organisation_id, patient_id, symptom_types, severity, notes) values (v_org, v_pat, array['hot_flashes']::public.menopause_symptom_type[], 5, 'S66B-NOTE-MENO');

  -- 1. sponsor / employer / pharmacist / admin / coordinator / other org / unrelated clinician: refused and audited; nothing leaks ----
  foreach v_who in array array[v_sp, v_emp, v_ph, v_adm, v_cc, v_untied, v_other] loop
    select count(*) into v_audits from public.audit_log where subject_patient_id = v_pat and actor_id = v_who;
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_json := public.read_reproductive_pattern_report_audited(v_pat, 'S66B proof: not my patient');
    execute 'reset role';
    if v_json ->> 'status' <> 'denied' or jsonb_array_length(v_json -> 'cycles') <> 0 or jsonb_array_length(v_json -> 'logs') <> 0 or jsonb_array_length(v_json -> 'menopause_logs') <> 0 then
      raise exception 'FAIL 1a: % was not denied: %', v_who, v_json; end if;
    select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_who and result = 'denied';
    if v_n <> v_audits + 1 and v_n <> 1 then raise exception 'FAIL 1b: refusal for % not audited (%)', v_who, v_n; end if;
  end loop;

  -- 2. the patient and the caregiver (with an explicit reproductive grant) are not on the staff path ---------------------------------
  foreach v_who in array array[v_pat, v_cg] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false; begin perform public.read_reproductive_pattern_report_audited(v_pat, 'S66B proof: patient role'); exception when sqlstate '42501' then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 2: % used the staff path', v_who; end if;
  end loop;

  -- 3. sponsor and employer cannot read the cycle tables directly either --------------------------------------------------------------
  foreach v_who in array array[v_sp, v_emp, v_ph] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select (select count(*) from public.menstrual_cycles where patient_id = v_pat) + (select count(*) from public.menstrual_daily_logs where patient_id = v_pat)
         + (select count(*) from public.menopause_symptom_logs where patient_id = v_pat) into v_n;
    execute 'reset role';
    if v_n <> 0 then raise exception 'FAIL 3: % reads cycle tables directly (% rows)', v_who, v_n; end if;
  end loop;

  -- 4. the tied clinician reads; audited; no notes, no temperature, no ovulation result ---------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_reproductive_pattern_report_audited(v_pat, 'S66B proof: tied clinician');
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'cycles') <> 3 or jsonb_array_length(v_json -> 'logs') <> 1 or jsonb_array_length(v_json -> 'menopause_logs') <> 1 then raise exception 'FAIL 4a: tied read: %', v_json; end if;
  if v_json::text ilike '%S66B-NOTE%' or v_json::text ilike '%36.71%' or v_json::text ilike '%positive%' or v_json::text ilike '%basal%' or v_json::text ilike '%ovulation%' then raise exception 'FAIL 4b: notes, temperature or ovulation data leaked: %', v_json; end if;
  select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_tied and result = 'success' and event -> 'sections' ? 'reproductive_pattern_report';
  if v_n <> 1 then raise exception 'FAIL 4c: expected 1 success audit row, found %', v_n; end if;
  -- a short reason raises and writes nothing
  execute 'set local role authenticated';
  v_failed := false; begin perform public.read_reproductive_pattern_report_audited(v_pat, 'x'); exception when sqlstate '22023' then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 4d: a short reason was accepted'; end if;

  -- 5. the patient sees who looked, and who was refused; another patient sees nothing ----------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_reproductive_access_log(50);
  execute 'reset role';
  if jsonb_array_length(v_json) < 8 or not (v_json::text like '%S66B Tied Doctor%') or not (v_json::text like '%denied%') then raise exception 'FAIL 5a: access log: %', v_json; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_reproductive_access_log(50);
  execute 'reset role';
  if jsonb_array_length(v_json) <> 0 then raise exception 'FAIL 5b: another patient sees the access log'; end if;

  -- 6. the go-live guard: a real (non test) patient with the guard OFF is refused with 55000 and nothing is written -------------------------
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update public.profiles set is_test = false where id = v_pat;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_audits from public.audit_log where subject_patient_id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; begin perform public.read_reproductive_pattern_report_audited(v_pat, 'S66B proof: guard off'); exception when sqlstate '55000' then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 6a: the report ran with the go-live guard OFF'; end if;
  select count(*) into v_n from public.audit_log where subject_patient_id = v_pat; if v_n <> v_audits then raise exception 'FAIL 6b: a guard refusal wrote an audit row'; end if;
  if (select is_on from public.go_live_guards where key = 'reproductive_content_enabled') then raise exception 'FAIL 6c: the guard is ON'; end if;

  -- 7. grants ---------------------------------------------------------------------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.read_reproductive_pattern_report_audited(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.my_reproductive_access_log(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.reproductive_staff_tied(uuid)', 'EXECUTE') then raise exception 'FAIL 7: anon can execute'; end if;

  -- SABOTAGE: any signed-in user counts as tied; the unrelated clinician must now read (so the check above is real). Guard test pair restored first.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update public.profiles set is_test = true where id = v_pat;
  execute 'reset role';
  create or replace function private.reproductive_staff_tied(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select (select auth.uid()) is not null $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_reproductive_pattern_report_audited(v_pat, 'S66B proof: sabotage');
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' then raise exception 'SABOTAGE did not flip: the tie check is vacuous'; end if;

  raise notice 'PASS: S66 cycle pattern report';
end $$;

rollback;
