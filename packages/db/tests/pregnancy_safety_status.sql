-- ===========================================================================
-- Proof: public.pregnancy_safety_status (OQ-555 follow-up): a three-state pregnancy answer for safety checks.
--   * the patient herself and a clinician with the care tie get 'pregnant' / 'not_pregnant' (with has_record and the last delivery date);
--   * EVERY other caller gets 'unknown', never 'not_pregnant', for a pregnant patient: an untied clinician, a break-glass holder, a care coordinator
--     on the patient's care team, an admin, a sponsor, a caregiver with an explicit reproductive_health grant, another organisation's clinician,
--     another patient;
--   * a tied clinician asking about a patient with no pregnancy row gets 'not_pregnant' with has_record false (the platform default) so a caller that is
--     stricter can still tell "no record" apart;
--   * no session is refused (42501); anon cannot execute.
-- SABOTAGE (each must flip or the test raises VACUOUS TEST): (1) the tie check is replaced by "any signed-in user": the untied clinician then reads
-- 'pregnant'; (2) the refusal branch answers 'not_pregnant': the untied clinician then gets the dangerous answer.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures; test accounts only. Prints no result rows (it raises on any failure).
-- ===========================================================================
begin;

do $$
declare
  v_org uuid; v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid(); v_pat2 uuid := gen_random_uuid(); v_pat3 uuid := gen_random_uuid(); v_cg uuid := gen_random_uuid(); v_sp uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid(); v_cc uuid := gen_random_uuid(); v_untied uuid := gen_random_uuid(); v_bg uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_tied uuid := gen_random_uuid(); v_pa uuid;
  v_json jsonb; v_who uuid; v_failed boolean; v_flips integer := 0; v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'PSS Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, 'pss-' || substr(x::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_pat3, v_cg, v_sp, v_adm, v_cc, v_untied, v_bg, v_other, v_tied]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values
    (v_pat, v_org, 'patient', 'PSS Pregnant', '+2348055600001', true), (v_pat2, v_org, 'patient', 'PSS Not Pregnant', '+2348055600002', true),
    (v_pat3, v_org, 'patient', 'PSS No Record', '+2348055600003', true), (v_cg, v_org, 'patient', 'PSS Caregiver', '+2348055600004', true),
    (v_sp, v_org, 'hmo_admin', 'PSS Sponsor', '+2348055600005', true), (v_adm, v_org, 'admin', 'PSS Admin', '+2348055600006', true),
    (v_cc, v_org, 'care_coordinator', 'PSS Coordinator', '+2348055600007', true), (v_untied, v_org, 'clinician', 'PSS Untied Doctor', '+2348055600008', true),
    (v_bg, v_org, 'clinician', 'PSS Break Glass Doctor', '+2348055600009', true), (v_other, v_org2, 'clinician', 'PSS Other Org Doctor', '+2348055600010', true),
    (v_tied, v_org, 'clinician', 'PSS Tied Doctor', '+2348055600011', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_test = true;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update public.profiles set is_test = true where id in (v_pat, v_pat2, v_pat3, v_cg, v_sp, v_adm, v_cc, v_untied, v_bg, v_other, v_tied);
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied, 'PSS Tied Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values
    (v_org, v_pat, v_tied, v_cc, now()), (v_org, v_pat2, v_tied, v_cc, now()), (v_org, v_pat3, v_tied, v_cc, now())
  on conflict (patient_id) do update set clinician_id = v_tied, care_coordinator_id = v_cc;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_cg, 'manage', v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'reproductive_health');
  perform set_config('request.jwt.claims', null, true);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_pat, true), (v_org, v_pat2, false);
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v_pat2, current_date - 30);
  -- the other doctors get their clinical_staff row only now, after the data exists, so nothing auto-assigned could have tied them
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_untied, 'PSS Untied Doctor', true, now(), 'senior_medical_officer'), (v_org, v_bg, 'PSS Break Glass Doctor', true, now(), 'senior_medical_officer'),
    (v_org2, v_other, 'PSS Other Org Doctor', true, now(), 'senior_medical_officer');
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
    values (v_bg, v_org, v_pat, v_org, 'PSS proof', now() + interval '8 hours');

  -- 1. the callers who may look get the real answer ----------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.pregnancy_safety_status(v_pat);
  execute 'reset role';
  if v_json ->> 'pregnancy' <> 'pregnant' or (v_json ->> 'has_record')::boolean is distinct from true then raise exception 'FAIL 1a: the patient did not get her own status: %', v_json; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.pregnancy_safety_status(v_pat);
  if v_json ->> 'pregnancy' <> 'pregnant' then execute 'reset role'; raise exception 'FAIL 1b: tied clinician, pregnant patient: %', v_json; end if;
  v_json := public.pregnancy_safety_status(v_pat2);
  if v_json ->> 'pregnancy' <> 'not_pregnant' or (v_json ->> 'has_record')::boolean is distinct from true or (v_json ->> 'last_delivery_date')::date <> current_date - 30 then
    execute 'reset role'; raise exception 'FAIL 1c: tied clinician, not-pregnant patient with a delivery: %', v_json; end if;
  v_json := public.pregnancy_safety_status(v_pat3);
  if v_json ->> 'pregnancy' <> 'not_pregnant' or (v_json ->> 'has_record')::boolean is distinct from false then
    execute 'reset role'; raise exception 'FAIL 1d: tied clinician, no record: %', v_json; end if;
  execute 'reset role';

  -- 2. EVERYONE else gets 'unknown' for the pregnant patient: never 'not_pregnant', never an error -----------------------------------------------------
  foreach v_who in array array[v_untied, v_bg, v_cc, v_adm, v_sp, v_cg, v_other, v_pat2] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_json := public.pregnancy_safety_status(v_pat);
    execute 'reset role';
    if v_json ->> 'pregnancy' <> 'unknown' or (v_json ->> 'has_record')::boolean is distinct from false or v_json -> 'last_delivery_date' <> 'null'::jsonb then
      raise exception 'FAIL 2: % was told % about a pregnant patient', (select full_name from public.profiles where id = v_who), v_json; end if;
  end loop;

  -- 3. no session is refused; anon cannot execute -----------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role authenticated';
  v_failed := false; begin perform public.pregnancy_safety_status(v_pat); exception when sqlstate '42501' then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 3a: a call with no session was answered'; end if;
  if has_function_privilege('anon', 'public.pregnancy_safety_status(uuid)', 'EXECUTE') then raise exception 'FAIL 3b: anon can execute'; end if;

  -- SABOTAGE 1: any signed-in user counts as tied; the untied clinician must now be told 'pregnant' (so check 2 is real).
  v_def := pg_get_functiondef('private.reproductive_staff_tied(uuid)'::regprocedure);
  create or replace function private.reproductive_staff_tied(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select (select auth.uid()) is not null $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.pregnancy_safety_status(v_pat);
  execute 'reset role';
  if v_json ->> 'pregnancy' = 'pregnant' then v_flips := v_flips + 1; end if;
  execute v_def;

  -- SABOTAGE 2: the refusal branch answers 'not_pregnant' (the dangerous default). The untied clinician must now get it (so check 2 is real).
  create or replace function public.pregnancy_safety_status(p_patient uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $f$
    begin
      if not private.reproductive_staff_tied(p_patient) then return jsonb_build_object('pregnancy', 'not_pregnant', 'has_record', false, 'last_delivery_date', null); end if;
      return jsonb_build_object('pregnancy', 'pregnant', 'has_record', true, 'last_delivery_date', null);
    end $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.pregnancy_safety_status(v_pat);
  execute 'reset role';
  if v_json ->> 'pregnancy' = 'not_pregnant' then v_flips := v_flips + 1; end if;

  if v_flips < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage checks flipped', v_flips; end if;
  raise notice 'PASS: pregnancy_safety_status (% sabotage checks flipped)', v_flips;
end $$;

rollback;
