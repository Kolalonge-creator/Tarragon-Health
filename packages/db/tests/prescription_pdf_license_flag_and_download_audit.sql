-- ===========================================================================
-- Proof: *_prescription_pdf_staff_directory_license_flag.sql (patient-side prescription PDF, phase 1).
--
-- The PDF issuing rule needs "is the prescriber's licence currently verified?" from a PATIENT session, which cannot read clinical_staff.
-- Proves, with simulated sessions: a patient in the same organisation reads license_verified = true for a verified licence, false for a
-- never-verified one and false for an expired one; the view still exposes no licence dates, verifier or indemnity columns; anon cannot
-- read the view; another organisation's patient sees none of these staff. Also proves the download audit write: a patient inserts an
-- audit_log row naming themself as actor, and cannot insert one naming somebody else. SABOTAGE: redefining the flag as a constant true
-- makes the never-verified licence read as verified, and the same assertion catches it.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_ok uuid := gen_random_uuid();
  v_unver uuid := gen_random_uuid();
  v_exp uuid := gen_random_uuid();
  v_flag boolean;
  v_n integer;
  v_failed boolean;
  v_cols text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'Rx PDF Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'rxpdf-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_ok, v_unver, v_exp]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,   v_org,  'patient',   'RxPdf Patient',     '+2348058880401'),
    (v_pat2,  v_org2, 'patient',   'RxPdf Other Patient','+2348058880402'),
    (v_ok,    v_org,  'clinician', 'RxPdf Verified Dr', '+2348058880403'),
    (v_unver, v_org,  'clinician', 'RxPdf Unverified Dr','+2348058880404'),
    (v_exp,   v_org,  'clinician', 'RxPdf Expired Dr',  '+2348058880405')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, license_expires_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_ok,    'RxPdf Verified Dr',   true, now(), now() + interval '1 year', 'senior_medical_officer', 'MDCN', 'RXPDF-1', 'Probe', 'RXP-1', now() + interval '1 year'),
    (v_org, v_unver, 'RxPdf Unverified Dr', false, null,  null,                     'senior_medical_officer', 'MDCN', 'RXPDF-2', 'Probe', 'RXP-2', now() + interval '1 year'),
    (v_org, v_exp,   'RxPdf Expired Dr',    true, now() - interval '2 years', now() - interval '1 day', 'senior_medical_officer', 'MDCN', 'RXPDF-3', 'Probe', 'RXP-3', now() + interval '1 year');

  -- 1. a same-organisation patient sees the flag, per prescriber
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select license_verified into v_flag from public.clinical_staff_directory where profile_id = v_ok;
  if v_flag is distinct from true then raise exception 'FAIL: verified licence did not read as verified (%)', v_flag; end if;
  select license_verified into v_flag from public.clinical_staff_directory where profile_id = v_unver;
  if v_flag is distinct from false then raise exception 'FAIL: never-verified licence did not read as false (%)', v_flag; end if;
  select license_verified into v_flag from public.clinical_staff_directory where profile_id = v_exp;
  if v_flag is distinct from false then raise exception 'FAIL: expired licence did not read as false (%)', v_flag; end if;
  execute 'reset role';

  -- 2. no sensitive column leaked into the view
  select string_agg(column_name, ',') into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'clinical_staff_directory'
     and column_name ~ 'license_verified_at|license_expires_at|verified_by|indemnity|credential_verified';
  if v_cols is not null then raise exception 'FAIL: directory view exposes sensitive columns: %', v_cols; end if;

  -- 3. anon cannot read it
  execute 'set local role anon';
  v_failed := false;
  begin perform 1 from public.clinical_staff_directory limit 1;
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: anon read clinical_staff_directory'; end if;

  -- 4. another organisation's patient sees none of this organisation's staff
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_staff_directory where profile_id in (v_ok, v_unver, v_exp);
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL: other organisation saw % staff rows', v_n; end if;

  -- 5. the download audit write: a patient may record their own download, never someone else's
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_org, v_pat, 'prescription.pdf_downloaded', 'medications', gen_random_uuid(), v_pat, 'success',
          '{"rx_number":"TRG-RX-PROOF","version":1,"channel":"web","bundle":false}'::jsonb);
  v_failed := false;
  begin
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result)
    values (v_org, v_ok, 'prescription.pdf_downloaded', 'medications', gen_random_uuid(), v_pat, 'success');
  exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: a patient wrote an audit row naming another actor'; end if;

  -- SABOTAGE: a constant-true flag makes the never-verified licence read as verified; the step 1 assertion must catch it
  create or replace view public.clinical_staff_directory with (security_invoker = false) as
  select cs.id, cs.organisation_id, cs.profile_id, cs.full_name, cs.photo_url, cs.credential_type, cs.credential_number, cs.specialty, cs.bio,
         cs.active, cs.doctor_tier, cs.employment_type, cs.offers_therapy_sessions, true as license_verified
    from public.clinical_staff cs where cs.organisation_id = private.current_org_id();
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select license_verified into v_flag from public.clinical_staff_directory where profile_id = v_unver;
  execute 'reset role';
  if v_flag is distinct from true then raise exception 'SABOTAGE not effective: constant flag did not read true'; end if;

  raise notice 'rx pdf license flag + download audit: all assertions passed';
end $$;

rollback;
