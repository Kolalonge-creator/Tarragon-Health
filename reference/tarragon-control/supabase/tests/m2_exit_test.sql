-- M2 exit test (spec §20): "Expired-MDCN clinician auto-suspends
-- overnight; note signature block renders correctly under both models."
-- Run supabase/tests/m1_fixture.sql first.
--
-- IMPORTANT ordering note for anyone re-running the suite from scratch:
-- this file's first block confirms app_config.accountability_model
-- (sets set_by), which is the Phase 2 L3 guard on clinical_notes added in
-- 0006_accountability_model_and_l3_guard.sql. Any clinical_notes-touching
-- test (including invariants_test.sql's I5 block) must run AFTER this
-- file's first DO block, or after accountability_model is otherwise
-- confirmed -- before confirmation, clinical_notes INSERT is correctly
-- rejected by design.

-- L3: confirm accountability_model, as a superadmin, on the record.
do $$
declare
  v_set_by uuid;
begin
  reset role;
  -- Before confirmation, clinical_notes signing must be blocked.
  begin
    insert into clinical_notes (patient_id, clinician_id, note_type, body, accountability_model_at_signing, mdcn_number_at_signing)
    values ('33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', 'review', 'Should be blocked pre-L3-confirmation', 'tech_layer', 'MDCN-FIXTURE-001');
    raise exception 'FAIL L3: clinical_notes signing succeeded before accountability_model was confirmed';
  exception
    when others then
      if sqlerrm like 'L3 guard%' then
        raise notice 'PASS L3a: clinical_notes signing correctly blocked pre-confirmation (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  update app_config set set_by = '11111111-1111-1111-1111-111111111107', set_at = now() where key = 'accountability_model';
  select set_by into v_set_by from app_config where key = 'accountability_model';
  if v_set_by is null then raise exception 'FAIL L3: accountability_model still unconfirmed after UPDATE'; end if;
  raise notice 'PASS L3b: accountability_model confirmed by superadmin fixture, set_by populated';

  -- Now the same shape of note must succeed.
  insert into clinical_notes (patient_id, clinician_id, note_type, body, accountability_model_at_signing, mdcn_number_at_signing)
  values ('33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', 'review', 'Signed after L3 confirmation', 'tech_layer', 'MDCN-FIXTURE-001');
  raise notice 'PASS L3c: clinical_notes signing succeeds once accountability_model is confirmed';
end $$;

-- Clinician activation guard: MDCN expiry.
do $$
declare
  v_active boolean;
  v_reason text;
begin
  reset role;
  update clinicians set mdcn_expiry = current_date - 1, active = true, indemnity_provider = 'Fixture Indemnity Co', indemnity_policy_no = 'POL-001', indemnity_expiry = current_date + 365
  where id = '44444444-4444-4444-4444-444444444401';

  perform private.suspend_expired_clinicians();

  select active, suspended_reason into v_active, v_reason from clinicians where id = '44444444-4444-4444-4444-444444444401';
  if v_active <> false then raise exception 'FAIL M2: clinician with expired MDCN was not suspended'; end if;
  if v_reason not ilike '%MDCN%' then raise exception 'FAIL M2: suspended_reason does not mention MDCN, got %', v_reason; end if;
  raise notice 'PASS M2a: expired-MDCN clinician auto-suspends, reason=%', v_reason;
end $$;

-- Valid clinician (tech_layer): not suspended.
do $$
declare
  v_active boolean;
begin
  reset role;
  update clinicians set mdcn_expiry = current_date + 365, active = true, indemnity_provider = 'Fixture Indemnity Co', indemnity_policy_no = 'POL-001', indemnity_expiry = current_date + 365
  where id = '44444444-4444-4444-4444-444444444401';

  perform private.suspend_expired_clinicians();

  select active into v_active from clinicians where id = '44444444-4444-4444-4444-444444444401';
  if v_active <> true then raise exception 'FAIL M2: a fully valid tech_layer clinician was incorrectly suspended'; end if;
  raise notice 'PASS M2b: valid MDCN + indemnity clinician is not suspended';
end $$;

-- Indemnity expiry (tech_layer only).
do $$
declare
  v_active boolean;
  v_reason text;
begin
  reset role;
  update clinicians set mdcn_expiry = current_date + 365, active = true, indemnity_provider = 'Fixture Indemnity Co', indemnity_policy_no = 'POL-001', indemnity_expiry = current_date - 1
  where id = '44444444-4444-4444-4444-444444444401';

  perform private.suspend_expired_clinicians();

  select active, suspended_reason into v_active, v_reason from clinicians where id = '44444444-4444-4444-4444-444444444401';
  if v_active <> false then raise exception 'FAIL M2: clinician with expired indemnity (tech_layer) was not suspended'; end if;
  if v_reason not ilike '%ndemnity%' then raise exception 'FAIL M2: suspended_reason does not mention indemnity, got %', v_reason; end if;
  raise notice 'PASS M2c: expired-indemnity clinician auto-suspends under tech_layer, reason=%', v_reason;
end $$;

-- Provider model: indemnity requirements do not apply.
do $$
declare
  v_active boolean;
begin
  reset role;
  update app_config set value = '"provider"'::jsonb where key = 'accountability_model';
  update clinicians set mdcn_expiry = current_date + 365, active = true, indemnity_provider = null, indemnity_policy_no = null, indemnity_expiry = null
  where id = '44444444-4444-4444-4444-444444444401';

  perform private.suspend_expired_clinicians();

  select active into v_active from clinicians where id = '44444444-4444-4444-4444-444444444401';
  if v_active <> true then raise exception 'FAIL M2: provider-model clinician with valid MDCN but no indemnity was incorrectly suspended'; end if;
  raise notice 'PASS M2d: provider model does not require indemnity data';

  -- restore tech_layer and a fully valid clinician for the rest of the suite
  update app_config set value = '"tech_layer"'::jsonb where key = 'accountability_model';
  update clinicians set indemnity_provider = 'Fixture Indemnity Co', indemnity_policy_no = 'POL-001', indemnity_expiry = current_date + 365
  where id = '44444444-4444-4444-4444-444444444401';
end $$;

-- Self-update column restriction.
do $$
declare
  v_affected int;
begin
  reset role;
  -- force a real false->true transition to attempt -- without this, if
  -- active is already true, setting it to true again is a no-op the
  -- trigger correctly allows (nothing actually changed), which would make
  -- this test pass for the wrong reason.
  update clinicians set active = false where id = '44444444-4444-4444-4444-444444444401';

  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103','role','authenticated')::text, true);
  set local role authenticated;

  begin
    update clinicians set active = true where profile_id = auth.uid();
    raise exception 'FAIL M2: clinician self-update of `active` was NOT rejected';
  exception
    when others then
      if sqlerrm like 'Only `scope`%' then
        raise notice 'PASS M2e: clinician self-reactivation attempt correctly rejected (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  update clinicians set scope = array['hypertension','t2dm'] where profile_id = auth.uid();
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then raise exception 'FAIL M2: clinician could not self-edit `scope`'; end if;
  raise notice 'PASS M2f: clinician can self-edit `scope`';

  reset role;
end $$;

-- Superadmin can still touch credential fields (the legitimate path).
do $$
declare
  v_active boolean;
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111107','role','authenticated')::text, true);
  set local role authenticated;

  update clinicians set active = true where id = '44444444-4444-4444-4444-444444444401';
  select active into v_active from clinicians where id = '44444444-4444-4444-4444-444444444401';
  if v_active <> true then raise exception 'FAIL M2: superadmin could not update clinician credential fields'; end if;
  raise notice 'PASS M2g: superadmin retains full write access to clinician credential fields';

  reset role;
end $$;

-- handle_new_user: public-signup-shaped insert -> role defaults 'patient'.
do $$
declare
  v_role user_role;
  v_full_name text;
  v_new_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  reset role;
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', 'new.patient@fixture.test', '{}', json_build_object('full_name','New Fixture Patient')::jsonb, now(), now());

  select role, full_name into v_role, v_full_name from profiles where id = v_new_id;
  if v_role is distinct from 'patient' then raise exception 'FAIL M2: public signup did not default to role=patient, got %', v_role; end if;
  if v_full_name <> 'New Fixture Patient' then raise exception 'FAIL M2: full_name not picked up from raw_user_meta_data, got %', v_full_name; end if;
  raise notice 'PASS M2h: handle_new_user creates a patient profile with the right full_name';
end $$;

-- handle_new_user: admin-provisioned-shaped insert -> role from app_metadata.
do $$
declare
  v_role user_role;
  v_new_id uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
begin
  reset role;
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', 'new.coordinator@fixture.test', json_build_object('role','coordinator')::jsonb, '{}', now(), now());

  select role into v_role from profiles where id = v_new_id;
  if v_role is distinct from 'coordinator' then raise exception 'FAIL M2: admin-provisioned signup did not honour raw_app_meta_data.role, got %', v_role; end if;
  raise notice 'PASS M2i: handle_new_user honours raw_app_meta_data.role for admin-provisioned staff';
end $$;

-- handle_new_user: a public signup CANNOT self-grant a staff role by
-- forging raw_user_meta_data (the client-settable field) -- role must
-- still default to patient because only raw_app_meta_data is trusted.
do $$
declare
  v_role user_role;
  v_new_id uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
begin
  reset role;
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', 'forged.role@fixture.test', '{}', json_build_object('role','superadmin')::jsonb, now(), now());

  select role into v_role from profiles where id = v_new_id;
  if v_role is distinct from 'patient' then raise exception 'FAIL M2: a forged role in raw_user_meta_data (client-settable) was honoured, got %', v_role; end if;
  raise notice 'PASS M2j: a client-forged role in raw_user_meta_data is correctly ignored';
end $$;

select 'M2_EXIT_TEST_RESULT' as label, 'PASS' as result;
