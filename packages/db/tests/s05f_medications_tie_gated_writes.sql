-- ===========================================================================
-- Proof: *_s05f_medications_tie_gated_writes.sql and *_s05f_close_staff_access_medications.sql (S05f piece C2; INV-10, INV-12, OQ-11).
--
-- Proves, with simulated sessions: a tied Senior Medical Officer prescribes (source clinician, attributed to her, lifecycle fields
-- assigned) and an untied one, a tied Medical Officer, a patient, an admin, a pharmacist and another organisation's clinician are all
-- refused; a tied Medical Officer confirms a refill (stamped) and an untied one is refused with the same answer as an unknown id; after
-- the closing migration staff read, insert, update and delete nothing directly; the patient and an acting supporter still self-add, the
-- patient still stops her own medicine and changes reminder times, but cannot rewrite a clinician-prescribed row (OQ-11); a caregiver
-- grant still reads. SABOTAGE 1: restoring the old staff policies lets an untied clinician update directly. SABOTAGE 2: dropping the
-- allow-list trigger lets the patient change a prescribed dose.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_tied_smo uuid := gen_random_uuid();
  v_tied_mo uuid := gen_random_uuid();
  v_untied_smo uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_cg uuid := gen_random_uuid();
  v_pa uuid;
  v_who uuid;
  v_id uuid;
  v_min uuid;
  v_med uuid;
  v_pmed uuid;
  v_n integer;
  v_failed boolean;
  v_msg text;
  v_row public.medications%rowtype;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f C2 Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's05fc2-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_tied_smo, v_tied_mo, v_untied_smo, v_admin, v_pharm, v_other, v_sup, v_cg]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,        v_org,  'patient',    'S05fC2 Patient',      '+2348058880001'),
    (v_tied_smo,   v_org,  'clinician',  'S05fC2 Tied SMO',     '+2348058880002'),
    (v_tied_mo,    v_org,  'clinician',  'S05fC2 Tied MO',      '+2348058880003'),
    (v_untied_smo, v_org,  'clinician',  'S05fC2 Untied SMO',   '+2348058880004'),
    (v_admin,      v_org,  'admin',      'S05fC2 Admin',        '+2348058880005'),
    (v_pharm,      v_org,  'pharmacist', 'S05fC2 Pharmacist',   '+2348058880006'),
    (v_other,      v_org2, 'clinician',  'S05fC2 Other Org SMO','+2348058880007'),
    (v_sup,        v_org,  'patient',    'S05fC2 Supporter',    '+2348058880008'),
    (v_cg,         v_org,  'patient',    'S05fC2 Caregiver',    '+2348058880009')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat, 'proof-allergen-none', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org,  v_tied_smo,   'S05fC2 Tied SMO',      true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05F-1', now() + interval '1 year'),
    (v_org,  v_tied_mo,    'S05fC2 Tied MO',       true, now(), 'senior_medical_officer',        'Probe Indemnity', 'S05F-2', now() + interval '1 year'),
    (v_org,  v_untied_smo, 'S05fC2 Untied SMO',    true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05F-3', now() + interval '1 year'),
    (v_org2, v_other,      'S05fC2 Other Org SMO', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05F-4', now() + interval '1 year');
  -- tie: the care team's clinician slot holds the SMO and its second slot holds the MO (both are tied by care_team_assignment)
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, assigned_at)
  values (v_org, v_pat, v_tied_smo, v_tied_mo, now())
  on conflict (patient_id) do update set clinician_id = v_tied_smo, clinical_director_id = v_tied_mo;

  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_cg, v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  perform set_config('request.jwt.claims', null, true);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (v_pat, v_sup, v_pat, 'manage');

  -- 1. a tied Senior Medical Officer prescribes
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_id := public.prescribe_medication(v_pat, '  S05fC2 Amlodipine ', '5mg', 'daily', current_date + 30, null, null, 'Oral', 90, '30', 2, 'Hypertension', 'With water');
  execute 'reset role';
  select * into v_row from public.medications where id = v_id;
  if v_row.id is null or v_row.source <> 'clinician' or v_row.drug_name <> 'S05fC2 Amlodipine' or v_row.added_by is distinct from v_tied_smo
     or v_row.rx_number is null or v_row.schedule_times is null or v_row.patient_id <> v_pat or v_row.repeats_allowed <> 2 then
    raise exception 'FAIL 1a: the prescribed row is wrong: %', to_jsonb(v_row);
  end if;

  -- 1b. the minimal call (only the required arguments, what the form sends when every optional field is blank) must work: repeats_allowed
  --     is NOT NULL with a default of 0, and an explicit NULL does not take the default (this failed live before the fix)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_min := public.prescribe_medication(v_pat, 'S05fC2 Minimal drug', p_duration_days => 7, p_quantity => '7 tablets');
  execute 'reset role';
  select * into v_row from public.medications where id = v_min;
  if v_row.id is null or v_row.repeats_allowed <> 0 or v_row.source <> 'clinician' then
    raise exception 'FAIL 1b: the minimal prescribe call did not default repeats_allowed to 0: %', to_jsonb(v_row);
  end if;
  delete from public.medications where id = v_min;          -- keep the later row-count checks about the one prescribed row

  -- 2. everyone else is refused
  foreach v_who in array array[v_untied_smo, v_tied_mo, v_admin, v_pharm, v_other, v_pat] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin perform public.prescribe_medication(v_pat, 'S05fC2 Refused drug', p_duration_days => 7, p_quantity => '7 tablets');
    exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 2a: % was allowed to prescribe', v_who; end if;
  end loop;
  if exists (select 1 from public.medications where drug_name = 'S05fC2 Refused drug') then raise exception 'FAIL 2b: a refused prescription was written'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.prescribe_medication(v_pat, '   ');
  exception when invalid_parameter_value then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 2c: an empty drug name was accepted'; end if;
  if has_function_privilege('anon', 'public.prescribe_medication(uuid,text,text,text,date,jsonb,uuid,text,integer,text,integer,text,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_medication_refill(uuid,date)', 'EXECUTE') then
    raise exception 'FAIL 2d: anon can execute a medication write function';
  end if;

  -- 3. refill confirmation: a tied Medical Officer confirms (stamped); an untied clinician and an unknown id get the same refusal
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied_mo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.confirm_medication_refill(v_id, current_date + 60);
  execute 'reset role';
  select * into v_row from public.medications where id = v_id;
  if v_row.refill_date <> current_date + 60 or v_row.last_confirmed_by is null or v_row.last_confirmed_at is null then
    raise exception 'FAIL 3a: the refill was not confirmed and stamped: %', to_jsonb(v_row);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.confirm_medication_refill(v_id, current_date + 90);
  exception when insufficient_privilege then v_failed := true; v_msg := sqlerrm; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 3b: an untied clinician confirmed a refill'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_medication_refill(gen_random_uuid(), current_date);
  exception when insufficient_privilege then
    if sqlerrm <> v_msg then execute 'reset role'; raise exception 'FAIL 3c: an unknown id answers differently from an untied one (% vs %)', sqlerrm, v_msg; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.confirm_medication_refill(v_id, current_date + 90);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 3d: a patient confirmed a refill through the staff function'; end if;
  -- the confirm-only trigger still blocks a Medical Officer from confirming a patient-added medicine
  insert into public.medications (organisation_id, patient_id, drug_name, source) values (v_org, v_pat, 'S05fC2 Self-added', 'patient') returning id into v_pmed;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied_mo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.confirm_medication_refill(v_pmed, current_date + 90);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 3e: a Medical Officer confirmed a refill on a patient-added medicine'; end if;

  -- 4. the table is closed to staff: no direct read, insert, update or delete (the tied clinician too)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.medications;
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL 4a: a tied clinician read % rows directly', v_n; end if;
  v_failed := false;
  begin insert into public.medications (organisation_id, patient_id, drug_name, source) values (v_org, v_pat, 'S05fC2 Direct', 'clinician');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 4b: a clinician inserted a medication directly'; end if;
  update public.medications set refill_date = current_date + 5 where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL 4c: a clinician updated % rows directly', v_n; end if;
  delete from public.medications where id = v_id;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4d: a clinician deleted % rows directly', v_n; end if;

  -- 5. the patient: reads her own, self-adds, stops, changes reminder times; cannot rewrite a prescribed row or add a clinician row
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.medications;
  if v_n <> 2 then execute 'reset role'; raise exception 'FAIL 5a: the patient reads % medications, expected 2', v_n; end if;
  insert into public.medications (organisation_id, patient_id, drug_name, source) values (v_org, v_pat, 'S05fC2 Patient add', 'patient');
  v_failed := false;
  begin insert into public.medications (organisation_id, patient_id, drug_name, source) values (v_org, v_pat, 'S05fC2 Forged', 'clinician');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 5b: a patient inserted a clinician-sourced medication'; end if;
  perform set_config('app.change_reason', 'S05fC2 proof: patient edit', true);
  update public.medications set schedule_times = '["08:00"]'::jsonb where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 5c: the patient could not change reminder times on a prescribed medicine'; end if;
  v_failed := false;
  begin update public.medications set dose = '500mg' where id = v_id;
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 5d: the patient rewrote the dose of a prescribed medicine'; end if;
  v_failed := false;
  begin update public.medications set drug_name = 'Other', instructions = 'x', repeats_allowed = 9 where id = v_id;
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 5e: the patient rewrote prescribed fields'; end if;
  update public.medications set is_active = false, stopped_at = now(), stopped_reason = 'S05fC2 side effects' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 5f: the patient could not stop a prescribed medicine'; end if;
  update public.medications set dose = '2mg' where id = v_pmed;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 5g: the patient could not edit a medicine she added herself'; end if;

  -- 6. an acting supporter self-adds (source patient); a caregiver with the grant reads
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.medications (organisation_id, patient_id, drug_name, source) values (v_org, v_pat, 'S05fC2 Supporter add', 'patient');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.medications;
  execute 'reset role';
  if v_n <> 4 then raise exception 'FAIL 6a: the caregiver reads % medications, expected 4', v_n; end if;

  -- SABOTAGE 1: the old staff policies would let an untied clinician update (and read) directly
  create policy s05f_sabotage_staff_select on public.medications for select to authenticated using (private.is_org_staff(organisation_id));
  create policy s05f_sabotage_staff_update on public.medications for update to authenticated
    using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.medications set refill_date = current_date + 7 where id = v_pmed;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n = 0 then raise exception 'SABOTAGE 1 FAIL: the old staff policies did not let an untied clinician update, so checks 4a/4c prove nothing'; end if;
  drop policy s05f_sabotage_staff_select on public.medications;
  drop policy s05f_sabotage_staff_update on public.medications;

  -- SABOTAGE 2: without the allow-list trigger the patient rewrites the prescribed dose
  update public.medications set is_active = true, stopped_at = null where id = v_id;
  alter table public.medications disable trigger medications_a_patient_allowlist;
  alter table public.medications disable trigger medications_b_require_signed_prescription;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.medications set dose = '999mg' where id = v_id;
  get diagnostics v_n = row_count;
  execute 'reset role';
  alter table public.medications enable trigger medications_a_patient_allowlist;
  alter table public.medications enable trigger medications_b_require_signed_prescription;
  if v_n = 0 or (select dose from public.medications where id = v_id) <> '999mg' then
    raise exception 'SABOTAGE 2 FAIL: disabling the allow-list trigger did not let the patient rewrite the dose, so checks 5d/5e prove nothing';
  end if;
end $$;

rollback;
