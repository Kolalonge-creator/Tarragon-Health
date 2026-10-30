-- ===========================================================================
-- Proof: OQ-555 / OQ-558 audited, tied staff reads of the Women's Health record (INV-10, INV-12; reproductive_health category rules).
-- Tables: patient_pregnancy, antenatal_visits, postnatal_profiles, breast_symptom_reports, fertility_assessment_requests.
-- Simulated sessions: the patient, a caregiver with 'manage' AND an explicit reproductive_health grant, a sponsor, an admin, a care coordinator who is
-- on the patient's care team, an UNRELATED clinician, an UNRELATED clinician holding a live break-glass (emergency) grant, a clinician of ANOTHER
-- organisation, and the TIED clinician.
--   * public.read_womens_health_record_audited(patient) takes NO reason. Only the tied clinician is answered 'ok' with all five record kinds;
--     every other staff caller (including the break-glass holder) is answered 'denied' with nothing in it, and the refusal is audited;
--   * every success and every refusal writes one audit row (section womens_health_record); the audit row is written BEFORE the read, so a failing
--     audit insert means nothing is returned (proved by making the audit writer raise);
--   * a direct SELECT of the four reproductive_health tables returns nothing for an untied clinician, a coordinator, the break-glass holder, another
--     organisation's clinician, a caregiver (these tables have no caregiver arm) and a sponsor; the tied clinician and the patient still read their own rows
--     (controls); the tied clinician can still progress a fertility request and an untied one cannot;
--   * the patient sees the openings and the refusals in my_reproductive_access_log, another patient sees none;
--   * OQ-558: the cycle report function still works with the old two-argument call, works with NO reason, and still refuses a too-short reason;
--   * anon cannot execute either function.
-- SABOTAGE (three, each must flip or the test raises VACUOUS TEST): (1) the audit writer is replaced by a no-op, so the success audit row disappears;
-- (2) the tie check is replaced by "any signed-in user", so an untied clinician reads through the function AND directly; (3) the audit writer raises,
-- which must stop the read (control for the fail-closed claim, not a flip).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures; test accounts only. Prints no result rows (it raises on any failure).
-- ===========================================================================
begin;

do $$
declare
  v_org uuid; v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid(); v_pat2 uuid := gen_random_uuid(); v_cg uuid := gen_random_uuid(); v_sp uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid(); v_cc uuid := gen_random_uuid(); v_untied uuid := gen_random_uuid(); v_bg uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_tied uuid := gen_random_uuid(); v_pa uuid;
  v_fert uuid;
  v_json jsonb; v_n integer; v_base integer; v_failed boolean; v_who uuid;
  v_audit_def text; v_flips integer := 0; v_tbl text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'OQ555 Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, 'oq555-' || substr(x::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_cg, v_sp, v_adm, v_cc, v_untied, v_bg, v_other, v_tied]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values
    (v_pat, v_org, 'patient', 'OQ555 Patient', '+2348055500001', true), (v_pat2, v_org, 'patient', 'OQ555 Patient Two', '+2348055500002', true),
    (v_cg, v_org, 'patient', 'OQ555 Caregiver', '+2348055500003', true), (v_sp, v_org, 'hmo_admin', 'OQ555 Sponsor', '+2348055500004', true),
    (v_adm, v_org, 'admin', 'OQ555 Admin', '+2348055500005', true), (v_cc, v_org, 'care_coordinator', 'OQ555 Coordinator', '+2348055500006', true),
    (v_untied, v_org, 'clinician', 'OQ555 Untied Doctor', '+2348055500007', true), (v_bg, v_org, 'clinician', 'OQ555 Break Glass Doctor', '+2348055500008', true),
    (v_other, v_org2, 'clinician', 'OQ555 Other Org Doctor', '+2348055500009', true), (v_tied, v_org, 'clinician', 'OQ555 Tied Doctor', '+2348055500010', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_test = true;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update public.profiles set is_test = true where id in (v_pat, v_pat2, v_cg, v_sp, v_adm, v_cc, v_untied, v_bg, v_other, v_tied);
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied, 'OQ555 Tied Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pat, v_tied, v_cc, now())
  on conflict (patient_id) do update set clinician_id = v_tied, care_coordinator_id = v_cc;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_cg, 'manage', v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'reproductive_health');
  perform set_config('request.jwt.claims', null, true);

  -- the five record kinds, with a free-text note in each place a clinician would read one
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, estimated_due_date, high_risk, high_risk_notes)
    values (v_org, v_pat, true, current_date + 120, true, 'OQ555-NOTE-HIGHRISK');
  insert into public.antenatal_visits (organisation_id, patient_id, visit_number, gestational_week_at_visit, findings) values (v_org, v_pat, 1, 12, 'OQ555-NOTE-ANTE');
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode, complications) values (v_org, v_pat, current_date - 40, 'vaginal', 'OQ555-NOTE-POST');
  insert into public.breast_symptom_reports (organisation_id, patient_id, symptom_types, laterality) values (v_org, v_pat, array['lump']::public.breast_symptom_type[], 'left');
  insert into public.fertility_assessment_requests (organisation_id, patient_id, trying_duration_months, concern_notes) values (v_org, v_pat, 14, 'OQ555-NOTE-FERT')
    returning id into v_fert;
  -- The rows above can raise a clinician alert that is auto-assigned to the least-loaded active doctor, and an assigned alert IS a care tie (INV-12). So the
  -- untied, break-glass and other-organisation doctors get their clinical_staff row only NOW, after the alert exists, and can never have been picked.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_untied, 'OQ555 Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org, v_bg, 'OQ555 Break Glass Doctor', true, now(), 'senior_medical_officer'), (v_org2, v_other, 'OQ555 Other Org Doctor', true, now(), 'senior_medical_officer');
  -- a live break-glass grant for the untied "break glass" doctor (reproductive_health is excluded from it)
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
    values (v_bg, v_org, v_pat, v_org, 'OQ555 proof', now() + interval '8 hours');

  -- 1. every non-tied staff caller: 'denied', nothing in it, refusal audited ----------------------------------------------------------------------
  foreach v_who in array array[v_sp, v_adm, v_cc, v_untied, v_bg, v_other] loop
    select count(*) into v_base from public.audit_log where subject_patient_id = v_pat and actor_id = v_who and result = 'denied' and event -> 'sections' ? 'womens_health_record';
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_json := public.read_womens_health_record_audited(v_pat);
    execute 'reset role';
    if v_json ->> 'status' <> 'denied' or v_json -> 'pregnancy' <> 'null'::jsonb or jsonb_array_length(v_json -> 'antenatal_visits') <> 0
       or jsonb_array_length(v_json -> 'postnatal_profiles') <> 0 or jsonb_array_length(v_json -> 'breast_reports') <> 0
       or jsonb_array_length(v_json -> 'fertility_requests') <> 0 or v_json::text like '%OQ555-NOTE%' then
      raise exception 'FAIL 1a: % (%) was not denied cleanly: %', (select full_name from public.profiles where id = v_who), v_who, left(v_json::text, 60); end if;
    select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_who and result = 'denied' and event -> 'sections' ? 'womens_health_record';
    if v_n <> v_base + 1 then raise exception 'FAIL 1b: the refusal for % was not audited (% -> %)', v_who, v_base, v_n; end if;
  end loop;
  -- the break-glass refusal records its basis, so a reviewer can see an emergency grant was NOT enough
  if not exists (select 1 from public.audit_log where subject_patient_id = v_pat and actor_id = v_bg and result = 'denied' and event ->> 'basis' = 'break_glass') then
    raise exception 'FAIL 1c: the break-glass refusal did not record its basis'; end if;

  -- 2. the patient and a caregiver (explicit reproductive grant) are not on the staff path; they write no audit row -----------------------------------
  foreach v_who in array array[v_pat, v_cg] loop
    select count(*) into v_base from public.audit_log where subject_patient_id = v_pat and actor_id = v_who;
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false; begin perform public.read_womens_health_record_audited(v_pat); exception when sqlstate '42501' then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 2a: % used the staff path', v_who; end if;
    select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_who;
    if v_n <> v_base then raise exception 'FAIL 2b: a refused patient-role call wrote an audit row'; end if;
  end loop;

  -- 3. direct SELECT of the four reproductive tables: nothing for anyone not tied (and for a caregiver, who has no arm here) --------------------------
  foreach v_who in array array[v_sp, v_adm, v_cc, v_untied, v_bg, v_other, v_cg, v_pat2] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select (select count(*) from public.patient_pregnancy where patient_id = v_pat) + (select count(*) from public.antenatal_visits where patient_id = v_pat)
         + (select count(*) from public.postnatal_profiles where patient_id = v_pat) + (select count(*) from public.fertility_assessment_requests where patient_id = v_pat)
      into v_n;
    execute 'reset role';
    if v_n <> 0 then raise exception 'FAIL 3a: % reads reproductive tables directly (% rows)', v_who, v_n; end if;
  end loop;
  -- controls: the patient reads her own rows; the tied clinician still reads directly (the policy is a tie, not a lock-out)
  foreach v_who in array array[v_pat, v_tied] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select (select count(*) from public.patient_pregnancy where patient_id = v_pat) + (select count(*) from public.antenatal_visits where patient_id = v_pat)
         + (select count(*) from public.postnatal_profiles where patient_id = v_pat) + (select count(*) from public.fertility_assessment_requests where patient_id = v_pat)
      into v_n;
    execute 'reset role';
    if v_n <> 4 then raise exception 'FAIL 3b: % cannot read the 4 rows they should (%)', v_who, v_n; end if;
  end loop;
  -- breast reports keep their registered policy (medical_history): an untied clinician still gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.breast_symptom_reports where patient_id = v_pat;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 3c: an untied clinician reads breast reports directly'; end if;

  -- 4. the tied clinician: 'ok' with all five kinds, one success audit row, no reason argument anywhere ----------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_womens_health_record_audited(v_pat);
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or (v_json -> 'pregnancy' ->> 'is_pregnant')::boolean is distinct from true
     or jsonb_array_length(v_json -> 'antenatal_visits') <> 1 or jsonb_array_length(v_json -> 'postnatal_profiles') <> 1
     or jsonb_array_length(v_json -> 'breast_reports') <> 1 or jsonb_array_length(v_json -> 'fertility_requests') <> 1 then
    raise exception 'FAIL 4a: tied read: %', v_json; end if;
  if v_json::text not like '%OQ555-NOTE-HIGHRISK%' or v_json::text not like '%OQ555-NOTE-FERT%' then raise exception 'FAIL 4b: the notes a clinician needs are missing: %', v_json; end if;
  select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_tied and result = 'success' and event -> 'sections' ? 'womens_health_record';
  if v_n <> 1 then raise exception 'FAIL 4c: expected 1 success audit row, found %', v_n; end if;
  if not exists (select 1 from public.audit_log where subject_patient_id = v_pat and actor_id = v_tied and event ->> 'basis' = 'tied' and coalesce(reason, '') <> '') then
    raise exception 'FAIL 4d: the success audit row has no tied basis or no server-set reason'; end if;
  if (select count(*) from pg_proc where proname = 'read_womens_health_record_audited' and pronargs <> 1) <> 0 then raise exception 'FAIL 4e: the audited read takes more than the patient'; end if;
  -- the tied clinician progresses a fertility request; an untied one cannot (the UPDATE needs a visible row)
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.fertility_assessment_requests set status = 'closed' where id = v_fert;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4f: an untied clinician updated a fertility request'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.fertility_assessment_requests set status = 'education_provided' where id = v_fert;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 4g: the tied clinician cannot progress a fertility request (%)', v_n; end if;

  -- 5. the patient sees who looked and who was refused; another patient sees nothing ------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_reproductive_access_log(50);
  execute 'reset role';
  if jsonb_array_length(v_json) < 7 or not (v_json::text like '%OQ555 Tied Doctor%') or not (v_json::text like '%denied%') then raise exception 'FAIL 5a: access log: %', v_json; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_reproductive_access_log(50);
  execute 'reset role';
  if jsonb_array_length(v_json) <> 0 then raise exception 'FAIL 5b: another patient sees the access log'; end if;

  -- 6. OQ-558: the cycle report no longer needs a reason, still accepts one, still refuses a too-short one -----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_reproductive_pattern_report_audited(v_pat);
  v_failed := false; begin perform public.read_reproductive_pattern_report_audited(v_pat, 'x'); exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 6a: a too-short reason was accepted'; end if;
  perform public.read_reproductive_pattern_report_audited(v_pat, 'OQ555 proof: an old caller still sending a reason');
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' then raise exception 'FAIL 6b: the no-reason cycle report did not answer ok: %', v_json; end if;
  select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_tied and result = 'success' and event -> 'sections' ? 'reproductive_pattern_report'
     and reason in ('Clinician opened the cycle pattern report', 'OQ555 proof: an old caller still sending a reason');
  if v_n <> 2 then raise exception 'FAIL 6c: expected 2 cycle-report audit rows (fixed phrase and sent reason), found %', v_n; end if;

  -- 7. grants ----------------------------------------------------------------------------------------------------------------------------------------
  if has_function_privilege('anon', 'public.read_womens_health_record_audited(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_reproductive_pattern_report_audited(uuid,text)', 'EXECUTE') then raise exception 'FAIL 7: anon can execute'; end if;

  -- CONTROL FOR "FAIL CLOSED": if the audit row cannot be written the read raises and returns nothing ---------------------------------------------------
  v_audit_def := pg_get_functiondef('private.audit_chart_read(uuid,text[],text,text)'::regprocedure);
  create or replace function private.audit_chart_read(p_patient uuid, p_sections text[], p_reason text, p_result text) returns uuid language plpgsql security definer set search_path = '' as $f$
    begin raise exception 'audit store unavailable' using errcode = 'XX000'; end $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; begin v_json := public.read_womens_health_record_audited(v_pat); exception when sqlstate 'XX000' then v_failed := true; end;
  execute 'reset role';
  execute v_audit_def;
  if not v_failed then raise exception 'FAIL 8: the Women''s Health record was returned although the audit row could not be written'; end if;

  -- SABOTAGE 1: the audit writer does nothing. The success audit row must NOT appear (so check 4c is real).
  create or replace function private.audit_chart_read(p_patient uuid, p_sections text[], p_reason text, p_result text) returns uuid language sql security definer set search_path = '' as $f$
    select gen_random_uuid() $f$;
  select count(*) into v_base from public.audit_log where subject_patient_id = v_pat and actor_id = v_tied and result = 'success' and event -> 'sections' ? 'womens_health_record';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_womens_health_record_audited(v_pat);
  execute 'reset role';
  select count(*) into v_n from public.audit_log where subject_patient_id = v_pat and actor_id = v_tied and result = 'success' and event -> 'sections' ? 'womens_health_record';
  if v_n = v_base then v_flips := v_flips + 1; end if;
  execute v_audit_def;

  -- SABOTAGE 2: any signed-in user counts as tied. The untied clinician must now read through the function AND directly (so checks 1 and 3 are real).
  create or replace function private.reproductive_staff_tied(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select (select auth.uid()) is not null $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_womens_health_record_audited(v_pat);
  if v_json ->> 'status' = 'ok' then v_flips := v_flips + 1; end if;
  select count(*) into v_n from public.patient_pregnancy where patient_id = v_pat;
  if v_n = 1 then v_flips := v_flips + 1; end if;
  execute 'reset role';

  if v_flips < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotage checks flipped', v_flips; end if;
  raise notice 'PASS: OQ-555/OQ-558 Women''s Health audited tied reads (% sabotage checks flipped)', v_flips;
end $$;

rollback;
