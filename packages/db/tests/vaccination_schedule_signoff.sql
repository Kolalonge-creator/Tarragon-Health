-- Tarragon Health — vaccination_schedule_signoffs verification
--
-- Proves the forge-proof sign-off gate for public.sign_vaccination_schedule,
-- mirroring cv_risk_config's proven test shape. Run inside a transaction that
-- is always rolled back — nothing here should ever be committed.
--
-- Checks:
--   1. A non-director clinical_staff session cannot sign a draft.
--   2. An active Clinical Director CAN sign it.
--   3. The signed row is correctly activated and attributed to the real
--      clinical_staff id, never client-supplied.
--   4. Only one signoff is ever active — signing a second retires the first.
--
-- Run: paste into the SQL editor / apply via execute_sql, wrapped in
-- `begin; ... rollback;` (already included below).

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_nondirector_profile uuid := gen_random_uuid();
  v_director_profile uuid := gen_random_uuid();
  v_nondirector_staff uuid;
  v_director_staff uuid;
  v_draft_id uuid;
  v_result uuid;
  v_failed boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_nondirector_profile, 'sig-test-nondirector@example.invalid', 'x', now(), '{}', '{}'),
    (v_director_profile, 'sig-test-director@example.invalid', 'x', now(), '{}', '{}');

  -- handle_new_user already created the profiles rows on the auth.users
  -- insert above; just set what this fixture needs.
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Sig Test Nondirector'
    where id = v_nondirector_profile;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Sig Test Director'
    where id = v_director_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_nondirector_profile, v_org, 'Sig Test Nondirector', 'tier_1', false, true, 'MDCN', 'SIGTEST-001', true, v_verifier, v_verifier, now())
  returning id into v_nondirector_staff;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_director_profile, v_org, 'Sig Test Director', 'tier_4_senior_registrar', true, true, 'MDCN', 'SIGTEST-002', true, v_verifier, v_verifier, now())
  returning id into v_director_staff;

  insert into public.vaccination_schedule_signoffs (version, notes)
  values (999001, 'rolled-back verification draft')
  returning id into v_draft_id;

  -- 1) Non-director cannot sign.
  perform set_config('request.jwt.claims', json_build_object('sub', v_nondirector_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.sign_vaccination_schedule(v_draft_id);
    v_failed := true; -- should not reach here
  exception when others then
    null; -- expected
  end;
  reset role;
  if v_failed then
    raise exception 'FAIL: non-director was able to sign';
  end if;

  -- 2) Real active Clinical Director CAN sign.
  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.sign_vaccination_schedule(v_draft_id) into v_result;
  reset role;
  if v_result is distinct from v_draft_id then
    raise exception 'FAIL: sign did not return the signoff id';
  end if;

  -- 3) Row is now active + attributed to the real director's clinical_staff id,
  -- never client-supplied.
  if not exists (
    select 1 from public.vaccination_schedule_signoffs
    where id = v_draft_id and is_active and approved_by = v_director_staff and approved_at is not null
  ) then
    raise exception 'FAIL: signoff row not correctly activated/attributed';
  end if;

  -- 4) One-active-at-a-time: a second signoff, once signed, retires the first.
  declare
    v_draft2_id uuid;
  begin
    insert into public.vaccination_schedule_signoffs (version, notes)
    values (999002, 'second rolled-back verification draft')
    returning id into v_draft2_id;

    perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.sign_vaccination_schedule(v_draft2_id);
    reset role;

    if exists (select 1 from public.vaccination_schedule_signoffs where id = v_draft_id and is_active) then
      raise exception 'FAIL: first signoff still active after a second was signed';
    end if;
    if not exists (select 1 from public.vaccination_schedule_signoffs where id = v_draft2_id and is_active) then
      raise exception 'FAIL: second signoff not active';
    end if;
  end;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
