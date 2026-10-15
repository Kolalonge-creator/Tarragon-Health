-- ===========================================================================
-- Proof: *_s05c_close_staff_reads_allergies_conditions.sql (S05c; INV-10).
--
-- Proves, with simulated sessions: the patient reads her own allergies and conditions; a tied clinician, an untied clinician and an
-- admin read NOTHING directly from either table; the tied clinician still gets both through the audited chart function (the gate
-- opens) and the untied one is denied there; a staff member's direct insert is refused (S05f); another patient reads none. SABOTAGE: restoring the old org-staff policy lets the untied clinician read, so the refusal checks
-- can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_json jsonb;
  v_n integer;
  v_id uuid;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05c-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_pat2,   's05c-pat2@example.invalid',   'x', now(), '{}', '{}'),
    (v_tied,   's05c-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's05c-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,  's05c-admin@example.invalid',  'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org, 'patient',   'S05c Patient One', '+2348053330001'),
    (v_pat2,   v_org, 'patient',   'S05c Patient Two', '+2348053330002'),
    (v_tied,   v_org, 'clinician', 'S05c Tied Doctor', '+2348053330003'),
    (v_untied, v_org, 'clinician', 'S05c Untied Doctor','+2348053330004'),
    (v_admin,  v_org, 'admin',     'S05c Admin',       '+2348053330005')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied,   'S05c Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'S05c Untied Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source)
  values (v_org, v_pat, 'S05c penicillin', 'hives', 'severe', 'clinician');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, date_identified)
  values (v_org, v_pat, 'S05c type 2 diabetes', 'active', current_date);

  -- the patient reads her own rows (the gate opens)
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergies;
  if v_n <> 1 then raise exception 'FAIL 1a: the patient reads % allergies, expected 1', v_n; end if;
  select count(*) into v_n from public.patient_conditions;
  if v_n <> 1 then raise exception 'FAIL 1b: the patient reads % conditions, expected 1', v_n; end if;
  execute 'reset role';

  -- another patient reads none
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergies;
  if v_n <> 0 then raise exception 'FAIL 1c: another patient read % allergies', v_n; end if;
  select count(*) into v_n from public.patient_conditions;
  if v_n <> 0 then raise exception 'FAIL 1c: another patient read % conditions', v_n; end if;
  execute 'reset role';

  -- staff read nothing directly: tied, untied, admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.patient_allergies) + (select count(*) from public.patient_conditions) into v_n;
  if v_n <> 0 then raise exception 'FAIL 2a: a tied clinician read % rows directly', v_n; end if;
  -- ... but the audited path opens for her
  select public.read_patient_chart_audited(v_pat, array['allergies','conditions'], 'S05c proof: tied clinician review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok'
     or jsonb_array_length(v_json -> 'sections' -> 'allergies') <> 1
     or jsonb_array_length(v_json -> 'sections' -> 'conditions') <> 1 then
    raise exception 'FAIL 2b: the tied clinician lost the audited read: %', v_json;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.patient_allergies) + (select count(*) from public.patient_conditions) into v_n;
  if v_n <> 0 then raise exception 'FAIL 2c: an untied clinician read % rows directly', v_n; end if;
  select public.read_patient_chart_audited(v_pat, array['allergies'], 'S05c proof: untied clinician attempt') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'denied' then raise exception 'FAIL 2d: an untied clinician was not denied: %', v_json; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.patient_allergies) + (select count(*) from public.patient_conditions) into v_n;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2e: an admin read % rows directly', v_n; end if;

  -- S05f: the staff write policies are gone, so there is nothing for a staff member to read back: a direct staff insert is refused outright
  -- (the same-transaction own-entry read-back this check used to prove only existed to support that insert).
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source, recorded_by)
    values (v_org, v_pat, 'S05c sulfa', 'rash', 'mild', 'clinician', v_tied);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 3a: a clinician inserted an allergy directly'; end if;

  -- SABOTAGE: the old org-staff policy would let the untied clinician read directly
  create policy s05c_sabotage_old_staff_read on public.patient_allergies for select to authenticated using (private.is_org_staff(organisation_id));
  create policy s05c_sabotage_old_staff_read on public.patient_conditions for select to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.patient_allergies) + (select count(*) from public.patient_conditions) into v_n;
  execute 'reset role';
  if v_n = 0 then raise exception 'FAIL SABOTAGE: the old policy did not expose the rows, so checks 2a/2c/2e prove nothing'; end if;

  raise notice 'S05c proof: all checks and the sabotage passed';
end $$;

rollback;
