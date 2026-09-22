-- Tarragon Health — CMO governed-config INSERT dual-gate verification
--
-- Proves the fix in 20260922192709_cmo_governed_config_insert_dual_gate.sql:
-- an active Clinical Director can insert a new draft version on each of the
-- 5 governed config tables that were previously admin-INSERT-only
-- (alert_rules, escalation_slas, mental_health_screening_cadences,
-- provider_quality_policy, vaccination_schedule_signoffs), and a plain
-- clinician (active, but no chief_medical_officer tier) still cannot. Mirrors
-- vaccination_schedule_signoff.sql's proven session-simulation shape. Run
-- inside a transaction that is always rolled back — nothing here should ever
-- be committed.
--
-- Checks per table:
--   1. A plain clinician (no CMO tier) cannot insert a draft — RLS refuses.
--   2. An active Clinical Director CAN insert a draft.
--   3. The inserted row lands unsigned/inactive, as the policy requires.

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_plain_profile uuid := gen_random_uuid();
  v_director_profile uuid := gen_random_uuid();
  v_plain_staff uuid;
  v_director_staff uuid;
  v_row_id uuid;
  v_failed boolean;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_plain_profile, 'cmo-gate-test-plain@example.invalid', 'x', now(), '{}', '{}'),
    (v_director_profile, 'cmo-gate-test-director@example.invalid', 'x', now(), '{}', '{}');

  -- handle_new_user already created the profiles rows on the auth.users
  -- insert above; just set what this fixture needs.
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Gate Test Plain Clinician'
    where id = v_plain_profile;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Gate Test Director'
    where id = v_director_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_plain_profile, v_org, 'Gate Test Plain Clinician', 'medical_officer', true, 'MDCN', 'GATETEST-001', true, v_verifier, v_verifier, now())
  returning id into v_plain_staff;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_director_profile, v_org, 'Gate Test Director', 'chief_medical_officer', true, 'MDCN', 'GATETEST-002', true, v_verifier, v_verifier, now())
  returning id into v_director_staff;

  -- ---- alert_rules ----------------------------------------------------
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.alert_rules (version, config, notes) values (999001, '[]'::jsonb, 'rolled-back gate proof');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then raise exception 'FAIL: plain clinician inserted an alert_rules draft'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.alert_rules (version, config, notes) values (999001, '[]'::jsonb, 'rolled-back gate proof') returning id into v_row_id;
  reset role;
  if not exists (select 1 from public.alert_rules where id = v_row_id and not is_active and approved_by is null) then
    raise exception 'FAIL: alert_rules draft not inserted unsigned/inactive';
  end if;

  -- ---- escalation_slas --------------------------------------------------
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.escalation_slas (version, config, notes) values (999001, '[]'::jsonb, 'rolled-back gate proof');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then raise exception 'FAIL: plain clinician inserted an escalation_slas draft'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.escalation_slas (version, config, notes) values (999001, '[]'::jsonb, 'rolled-back gate proof') returning id into v_row_id;
  reset role;
  if not exists (select 1 from public.escalation_slas where id = v_row_id and not is_active and approved_by is null) then
    raise exception 'FAIL: escalation_slas draft not inserted unsigned/inactive';
  end if;

  -- ---- mental_health_screening_cadences ----------------------------------
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.mental_health_screening_cadences (version, config, notes) values (999001, '[]'::jsonb, 'rolled-back gate proof');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then raise exception 'FAIL: plain clinician inserted a mental_health_screening_cadences draft'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.mental_health_screening_cadences (version, config, notes) values (999001, '[]'::jsonb, 'rolled-back gate proof') returning id into v_row_id;
  reset role;
  if not exists (select 1 from public.mental_health_screening_cadences where id = v_row_id and not is_active and approved_by is null) then
    raise exception 'FAIL: mental_health_screening_cadences draft not inserted unsigned/inactive';
  end if;

  -- ---- provider_quality_policy --------------------------------------------
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.provider_quality_policy (version, config, notes) values (999001, '{}'::jsonb, 'rolled-back gate proof');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then raise exception 'FAIL: plain clinician inserted a provider_quality_policy draft'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.provider_quality_policy (version, config, notes) values (999001, '{}'::jsonb, 'rolled-back gate proof') returning id into v_row_id;
  reset role;
  if not exists (select 1 from public.provider_quality_policy where id = v_row_id and not is_active and approved_by is null) then
    raise exception 'FAIL: provider_quality_policy draft not inserted unsigned/inactive';
  end if;

  -- ---- vaccination_schedule_signoffs --------------------------------------
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.vaccination_schedule_signoffs (version, notes) values (999001, 'rolled-back gate proof');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then raise exception 'FAIL: plain clinician inserted a vaccination_schedule_signoffs draft'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.vaccination_schedule_signoffs (version, notes) values (999001, 'rolled-back gate proof') returning id into v_row_id;
  reset role;
  if not exists (select 1 from public.vaccination_schedule_signoffs where id = v_row_id and not is_active and approved_by is null) then
    raise exception 'FAIL: vaccination_schedule_signoffs draft not inserted unsigned/inactive';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
