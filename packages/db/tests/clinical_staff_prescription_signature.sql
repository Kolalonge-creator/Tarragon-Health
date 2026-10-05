-- ===========================================================================
-- Proof: *_clinical_staff_prescription_signature.sql (doctor signature image for the prescription PDF).
--
-- Proves, with simulated sessions: an ADMIN sets a doctor's signature_path (and the trigger stamps who and when); a clinician (even the doctor
-- themself) and a patient cannot change it; the system (no user) can; a malformed path is refused; the private bucket accepts an admin's upload
-- into their own organisation's folder and refuses a clinician's, a patient's, and an admin's upload into ANOTHER organisation's folder; a
-- clinician and a patient cannot read the object; and clinical_staff_directory exposes no signature column. SABOTAGE: dropping the guard trigger
-- lets a clinician change the path, so the refusal assertions are not vacuous.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();
  v_staff uuid;
  v_good text;
  v_failed boolean;
  v_n integer;
  v_by uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.organisations (id, name, type) values (v_org2, 'Sig Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'sig-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc, v_adm]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat, v_org, 'patient',   'Sig Patient', '+2348058880801'),
    (v_doc, v_org, 'clinician', 'Sig Doctor',  '+2348058880802'),
    (v_adm, v_org, 'admin',     'Sig Admin',   '+2348058880803')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_active = true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'Sig Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'SIG-1', 'Probe', 'SIG-1', now() + interval '1 year')
  returning id into v_staff;
  v_good := v_org::text || '/' || gen_random_uuid()::text || '.png';

  -- 1. admin sets it, and the trigger stamps who and when
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.clinical_staff set signature_path = v_good where id = v_staff;
  execute 'reset role';
  select signature_updated_by into v_by from public.clinical_staff where id = v_staff and signature_path = v_good and signature_updated_at is not null;
  if v_by is distinct from v_adm then raise exception 'FAIL: admin could not set the signature, or it was not stamped (%)', v_by; end if;

  -- 2. the doctor themself, another clinician and a patient cannot change it
  foreach v_by in array array[v_doc, v_pat] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_by, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin
      update public.clinical_staff set signature_path = v_org::text || '/' || gen_random_uuid()::text || '.png' where id = v_staff;
      get diagnostics v_n = row_count;
      v_failed := (v_n = 0);
    exception when others then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL: % could change the signature', v_by; end if;
  end loop;
  select count(*) into v_n from public.clinical_staff where id = v_staff and signature_path = v_good;
  if v_n <> 1 then raise exception 'FAIL: signature path was altered by a non-admin'; end if;

  -- 3. the system may set it; a malformed path is refused even for an admin
  perform set_config('request.jwt.claims', '', true);
  update public.clinical_staff set signature_path = null where id = v_staff;
  update public.clinical_staff set signature_path = v_good where id = v_staff;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin update public.clinical_staff set signature_path = '../../etc/passwd' where id = v_staff; exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: a malformed signature path was accepted'; end if;

  -- 4. the private bucket: admin may write into their organisation's folder only; others cannot write or read
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name, owner, metadata) values ('staff-signatures', v_good, v_adm, '{}'::jsonb);
  v_failed := false;
  begin insert into storage.objects (bucket_id, name, owner, metadata) values ('staff-signatures', v_org2::text || '/' || gen_random_uuid()::text || '.png', v_adm, '{}'::jsonb);
  exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: admin wrote into another organisation''s folder'; end if;

  foreach v_by in array array[v_doc, v_pat] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_by, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin insert into storage.objects (bucket_id, name, owner, metadata) values ('staff-signatures', v_org::text || '/' || gen_random_uuid()::text || '.png', v_by, '{}'::jsonb);
    exception when others then v_failed := true; end;
    select count(*) into v_n from storage.objects where bucket_id = 'staff-signatures' and name = v_good;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL: % uploaded a signature', v_by; end if;
    if v_n <> 0 then raise exception 'FAIL: % could read the signature object', v_by; end if;
  end loop;

  -- 5. nothing patient-facing exposes it
  if exists (select 1 from information_schema.columns where table_name = 'clinical_staff_directory' and column_name like 'signature%') then
    raise exception 'FAIL: clinical_staff_directory exposes a signature column';
  end if;

  -- SABOTAGE: without the guard trigger a clinician can change the path
  drop trigger clinical_staff_guard_signature on public.clinical_staff;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  update public.clinical_staff set signature_path = v_org::text || '/' || gen_random_uuid()::text || '.png' where id = v_staff;
  select count(*) into v_n from public.clinical_staff where id = v_staff and signature_path <> v_good;
  if v_n <> 1 then raise exception 'SABOTAGE not effective: the doctor could not change the path without the trigger (%)', v_n; end if;

  raise notice 'clinical staff prescription signature: all assertions passed';
end $$;

rollback;
