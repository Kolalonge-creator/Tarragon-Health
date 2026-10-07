-- Tarragon Health — clinical_rules_insert CMO dual-gate verification
--
-- Proves the fix in 20260922193255_cmo_clinical_rules_insert_dual_gate.sql:
-- an active Clinical Director can insert a new draft clinical_rules row
-- (the "duplicate into a fresh draft to fix owner/protocol" step
-- signClinicalRuleWithGovernanceAction and draftNextClinicalRuleVersionAction
-- both depend on), and a plain clinician (active, no chief_medical_officer
-- tier) still cannot. Mirrors cmo_governed_config_insert_dual_gate.sql's
-- shape, including its sabotage step (check 0: temporarily restore the
-- pre-fix admin-only policy and confirm the Director insert that succeeds
-- in check 2 would have failed under it). Run inside a transaction that is
-- always rolled back.

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
  v_rule_key text := 'gate_test_rule_' || substr(gen_random_uuid()::text, 1, 8);
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_plain_profile, 'cr-gate-test-plain@example.invalid', 'x', now(), '{}', '{}'),
    (v_director_profile, 'cr-gate-test-director@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CR Gate Test Plain Clinician'
    where id = v_plain_profile;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CR Gate Test Director'
    where id = v_director_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_plain_profile, v_org, 'CR Gate Test Plain Clinician', 'medical_officer', true, 'MDCN', 'CRGATETEST-001', true, v_verifier, v_verifier, now())
  returning id into v_plain_staff;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_director_profile, v_org, 'CR Gate Test Director', 'chief_medical_officer', true, 'MDCN', 'CRGATETEST-002', true, v_verifier, v_verifier, now())
  returning id into v_director_staff;

  -- 0) Sabotage: prove this test would have caught the pre-fix bug. Put
  -- clinical_rules_insert back to its exact pre-migration shape
  -- (private.is_admin() only) and confirm the Director insert that succeeds
  -- in check 2 below would have failed under it. Restored to the real
  -- (fixed) policy immediately after, before any real check runs.
  alter policy clinical_rules_insert on public.clinical_rules
    with check (
      private.is_admin()
      and status = 'draft'
      and approved_by is null
      and approved_at is null
      and activated_at is null
    );

  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.clinical_rules (rule_key, version, name, description, category, domain, event_type, explanation_template)
    values (v_rule_key || '_sabotage', 1, 'Gate test rule', 'sabotage proof, must not persist', 'operational', 'engagement', 'appointment_missed', 'test');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then
    raise exception 'SABOTAGE FAILED: a Clinical Director inserted a clinical_rules draft under the pre-fix (admin-only) policy — this test would not have caught the original bug';
  end if;

  -- Restored to the real, currently-live shape: private.is_active_clinical_
  -- director() (20260922200335 folded the original inlined EXISTS into this
  -- pre-existing helper — see that migration's header).
  alter policy clinical_rules_insert on public.clinical_rules
    with check (
      (private.is_admin() or private.is_active_clinical_director())
      and status = 'draft'
      and approved_by is null
      and approved_at is null
      and activated_at is null
    );

  -- 1) Plain clinician cannot insert a draft clinical_rules row.
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_plain_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.clinical_rules (rule_key, version, name, description, category, domain, event_type, explanation_template)
    values (v_rule_key, 1, 'Gate test rule', 'rolled-back gate proof', 'operational', 'engagement', 'appointment_missed', 'test');
    v_failed := true;
  exception when others then null; end;
  reset role;
  if v_failed then raise exception 'FAIL: plain clinician inserted a clinical_rules draft'; end if;

  -- 2) Active Clinical Director CAN insert a draft.
  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.clinical_rules (rule_key, version, name, description, category, domain, event_type, explanation_template)
  values (v_rule_key, 1, 'Gate test rule', 'rolled-back gate proof', 'operational', 'engagement', 'appointment_missed', 'test')
  returning id into v_row_id;
  reset role;
  if not exists (
    select 1 from public.clinical_rules
    where id = v_row_id and status = 'draft' and approved_by is null and approved_at is null and activated_at is null
  ) then
    raise exception 'FAIL: clinical_rules draft not inserted correctly';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
