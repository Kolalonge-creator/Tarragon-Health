-- ===========================================================================
-- Proof: *_s05f_drop_staff_write_policies_four_tables.sql (INV-10): patient_documents, family_history, patient_allergies, patient_conditions.
--
-- Proves, with simulated sessions: a tied clinician, an untied clinician, an admin, a pharmacist and another organisation's clinician are
-- refused a direct INSERT into each of the four tables; the patient still inserts her own allergy, family-history row and
-- patient-sourced document, updates and deletes her own allergy and family-history row, cannot insert a clinician-sourced document or
-- a condition, and cannot write another patient's rows. SABOTAGE 1: restoring the old staff INSERT policies lets an untied clinician
-- insert. SABOTAGE 2: restoring an old staff UPDATE policy (with a staff read so the row is visible) lets an untied clinician update.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_who uuid;
  v_n integer;
  v_failed boolean;
  v_allergy uuid;
  v_fh uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f W Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's05fw-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_tied, v_untied, v_admin, v_pharm, v_other]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05fW Patient One', '+2348058880301'),
    (v_pat2,   v_org,  'patient',    'S05fW Patient Two', '+2348058880302'),
    (v_tied,   v_org,  'clinician',  'S05fW Tied Doctor', '+2348058880303'),
    (v_untied, v_org,  'clinician',  'S05fW Untied Doctor','+2348058880304'),
    (v_admin,  v_org,  'admin',      'S05fW Admin',       '+2348058880305'),
    (v_pharm,  v_org,  'pharmacist', 'S05fW Pharmacist',  '+2348058880306'),
    (v_other,  v_org2, 'clinician',  'S05fW Other Org Dr','+2348058880307')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org,  v_tied,   'S05fW Tied Doctor',   true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FW-1', now() + interval '1 year'),
    (v_org,  v_untied, 'S05fW Untied Doctor', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FW-2', now() + interval '1 year'),
    (v_org2, v_other,  'S05fW Other Org Dr',  true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FW-3', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  -- 1. no staff role inserts into any of the four tables directly
  foreach v_who in array array[v_tied, v_untied, v_admin, v_pharm, v_other] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat, 'S05fW refused', 'clinician');
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 1a: % inserted an allergy directly', v_who; end if;
    v_failed := false;
    begin insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, date_identified) values (v_org, v_pat, 'S05fW refused', 'active', current_date);
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 1b: % inserted a condition directly', v_who; end if;
    v_failed := false;
    begin insert into public.family_history (organisation_id, patient_id, condition_name, relationship) values (v_org, v_pat, 'S05fW refused', 'mother');
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 1c: % inserted a family-history row directly', v_who; end if;
    v_failed := false;
    begin insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source) values (v_org, v_pat, 'other', v_pat || '/refused.pdf', 'clinician');
    exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 1d: % inserted a document directly', v_who; end if;
  end loop;

  -- 2. the patient still writes her own rows
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source) values (v_org, v_pat, 'S05fW penicillin', 'hives', 'severe', 'patient') returning id into v_allergy;
  insert into public.family_history (organisation_id, patient_id, condition_name, relationship) values (v_org, v_pat, 'S05fW diabetes', 'mother') returning id into v_fh;
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source) values (v_org, v_pat, 'other', v_pat || '/own.pdf', 'patient');
  perform set_config('app.change_reason', 'S05fW proof: patient edit', true);
  update public.patient_allergies set reaction = 'rash' where id = v_allergy;
  get diagnostics v_n = row_count;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 2a: the patient could not update her own allergy'; end if;
  update public.family_history set condition_name = 'S05fW type 2 diabetes' where id = v_fh;
  get diagnostics v_n = row_count;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 2b: the patient could not update her own family-history row'; end if;
  delete from public.family_history where id = v_fh;
  get diagnostics v_n = row_count;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 2c: the patient could not delete her own family-history row'; end if;
  -- she cannot write another patient's rows, add a clinician-sourced document, or add a condition
  v_failed := false;
  begin insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat2, 'S05fW other', 'patient');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 2d: a patient inserted an allergy for another patient'; end if;
  v_failed := false;
  begin insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source) values (v_org, v_pat, 'other', v_pat || '/forged.pdf', 'clinician');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 2e: a patient inserted a clinician-sourced document'; end if;
  v_failed := false;
  begin insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, date_identified) values (v_org, v_pat, 'S05fW self-added', 'active', current_date);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 2f: a patient inserted a condition'; end if;

  -- SABOTAGE 1: the old staff INSERT policy would let an untied clinician insert an allergy
  create policy s05fw_sabotage_staff_insert on public.patient_allergies for insert to authenticated with check (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat, 'S05fW sabotage', 'clinician');
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if v_failed then raise exception 'SABOTAGE 1 FAIL: the old staff INSERT policy did not let an untied clinician insert, so check 1a proves nothing'; end if;
  drop policy s05fw_sabotage_staff_insert on public.patient_allergies;

  -- SABOTAGE 2: an old staff UPDATE policy (with a staff read so the row is visible) would let an untied clinician update
  create policy s05fw_sabotage_staff_select on public.patient_conditions for select to authenticated using (private.is_org_staff(organisation_id));
  create policy s05fw_sabotage_staff_update on public.patient_conditions for update to authenticated
    using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, date_identified) values (v_org, v_pat, 'S05fW seeded', 'active', current_date);
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.patient_conditions set status = 'resolved' where patient_id = v_pat;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n = 0 then raise exception 'SABOTAGE 2 FAIL: the old staff UPDATE policy did not let an untied clinician update, so the closed-write checks prove nothing'; end if;
end $$;

rollback;
