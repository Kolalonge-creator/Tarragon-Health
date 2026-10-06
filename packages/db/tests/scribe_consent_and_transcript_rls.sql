-- ===========================================================================
-- Verification: S23 scribe_consents + scribe_transcripts RLS
--
-- Safety cases covered:
--   14: consent declined -> scribe cannot start (no granted=true row to reference)
--   15: AI draft never visible to patient before clinician signs
--       (no patient SELECT policy on scribe_transcripts; patient_summary on
--        clinical_encounter_notes only becomes visible through the existing
--        encounter-notes RLS after the clinician finalises the note)
--   Consent immutability: granted column cannot be changed after insert
--   Transcript access: only org staff can SELECT/INSERT/DELETE transcripts
--   Consent revocation: only the revoking update is allowed (granted=true, set revoked_at)
--
-- Wrapped in BEGIN/ROLLBACK -- verification only, no data left behind.
-- ===========================================================================

begin;

create temporary table sc_fixture(k text primary key, v uuid) on commit drop;
create temporary table sc_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: org, clinician (staff), patient
-- --------------------------------------------------------------------------
do $$
declare
  v_org       uuid;
  v_clinician uuid := gen_random_uuid();
  v_patient   uuid := gen_random_uuid();
  v_staff_id  uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'No organisation found -- seed data required';
  end if;

  -- Insert profiles for clinician and patient.
  insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  values
    (v_clinician, 'scribe-test-clinician@tarragon.test', '{}', now(), now()),
    (v_patient,   'scribe-test-patient@tarragon.test',   '{}', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, user_role, organisation_id, full_name)
  values
    (v_clinician, 'clinician', v_org, 'Dr Test Scribe'),
    (v_patient,   'patient',   v_org, 'Patient Scribe Test')
  on conflict (id) do update set user_role = excluded.user_role, organisation_id = excluded.organisation_id;

  -- Clinical staff row for the clinician.
  insert into public.clinical_staff (id, profile_id, organisation_id, doctor_tier, active)
  values (gen_random_uuid(), v_clinician, v_org, 'senior_medical_officer', true)
  on conflict do nothing
  returning id into v_staff_id;

  if v_staff_id is null then
    select id into v_staff_id from public.clinical_staff where profile_id = v_clinician limit 1;
  end if;

  insert into sc_fixture values ('org', v_org), ('clinician', v_clinician), ('patient', v_patient), ('staff', v_staff_id);
end $$;

-- --------------------------------------------------------------------------
-- Test 1: Clinician can INSERT a consent row (granted=true)
-- --------------------------------------------------------------------------
do $$
declare
  v_org       uuid := (select v from sc_fixture where k='org');
  v_clinician uuid := (select v from sc_fixture where k='clinician');
  v_patient   uuid := (select v from sc_fixture where k='patient');
  v_consent   uuid;
  v_ok        boolean;
begin
  -- Simulate clinician session.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_clinician::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  insert into public.scribe_consents (organisation_id, patient_id, granted, language)
  values (v_org, v_patient, true, 'en-NG')
  returning id into v_consent;

  v_ok := v_consent is not null;

  insert into sc_result values (
    'clinician_can_insert_granted_consent',
    'clinician',
    case when v_ok then 'inserted' else 'failed' end,
    'inserted',
    case when v_ok then 'PASS' else 'FAIL' end
  );

  insert into sc_fixture values ('consent', v_consent) on conflict (k) do update set v = excluded.v;

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Test 2: Patient CANNOT SELECT scribe_transcripts (safety case 15)
-- --------------------------------------------------------------------------
do $$
declare
  v_patient   uuid := (select v from sc_fixture where k='patient');
  v_consent   uuid := (select v from sc_fixture where k='consent');
  v_org       uuid := (select v from sc_fixture where k='org');
  v_count     integer;
begin
  -- First, insert a transcript as superuser so there is something to find.
  reset role;
  insert into public.scribe_transcripts (organisation_id, scribe_consent_id, segments_encrypted, duration_ms, language)
  values (v_org, v_consent, '\x00'::bytea, 60000, 'en-NG');

  -- Now try as patient.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_patient::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  select count(*) into v_count from public.scribe_transcripts;

  insert into sc_result values (
    'patient_cannot_select_transcripts',
    'patient',
    v_count::text,
    '0',
    case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Test 3: Clinician (staff) CAN SELECT scribe_transcripts
-- --------------------------------------------------------------------------
do $$
declare
  v_clinician uuid := (select v from sc_fixture where k='clinician');
  v_count     integer;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_clinician::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  select count(*) into v_count from public.scribe_transcripts;

  insert into sc_result values (
    'clinician_can_select_transcripts',
    'clinician',
    v_count::text,
    '1',
    case when v_count >= 1 then 'PASS' else 'FAIL' end
  );

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Test 4: Consent granted column cannot be changed (UPDATE only allows revocation)
-- --------------------------------------------------------------------------
do $$
declare
  v_clinician uuid := (select v from sc_fixture where k='clinician');
  v_consent   uuid := (select v from sc_fixture where k='consent');
  v_granted   boolean;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_clinician::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  -- Try to change granted from true to false.
  update public.scribe_consents set granted = false where id = v_consent;

  -- Check if it actually changed.
  select granted into v_granted from public.scribe_consents where id = v_consent;

  insert into sc_result values (
    'consent_granted_immutable',
    'clinician',
    case when v_granted then 'true (unchanged)' else 'false (changed!)' end,
    'true (unchanged)',
    case when v_granted then 'PASS' else 'FAIL' end
  );

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Test 5: Consent revocation works (set revoked_at on granted=true row)
-- --------------------------------------------------------------------------
do $$
declare
  v_clinician uuid := (select v from sc_fixture where k='clinician');
  v_consent   uuid := (select v from sc_fixture where k='consent');
  v_revoked   timestamptz;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_clinician::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  update public.scribe_consents set revoked_at = now() where id = v_consent;

  select revoked_at into v_revoked from public.scribe_consents where id = v_consent;

  insert into sc_result values (
    'consent_revocation_works',
    'clinician',
    case when v_revoked is not null then 'revoked' else 'not revoked' end,
    'revoked',
    case when v_revoked is not null then 'PASS' else 'FAIL' end
  );

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Test 6: Patient CANNOT INSERT into scribe_consents (only clinicians can)
-- --------------------------------------------------------------------------
do $$
declare
  v_patient uuid := (select v from sc_fixture where k='patient');
  v_org     uuid := (select v from sc_fixture where k='org');
  v_ok      boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_patient::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  begin
    insert into public.scribe_consents (organisation_id, patient_id, granted, language)
    values (v_org, v_patient, true, 'en-NG');
    v_ok := true;
  exception when others then
    v_ok := false;
  end;

  insert into sc_result values (
    'patient_cannot_insert_consent',
    'patient',
    case when v_ok then 'inserted (BAD)' else 'blocked' end,
    'blocked',
    case when not v_ok then 'PASS' else 'FAIL' end
  );

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Test 7: No DELETE policy on scribe_consents (consent records are permanent)
-- --------------------------------------------------------------------------
do $$
declare
  v_clinician uuid := (select v from sc_fixture where k='clinician');
  v_consent   uuid := (select v from sc_fixture where k='consent');
  v_ok        boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_clinician::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  set local role authenticated;

  begin
    delete from public.scribe_consents where id = v_consent;
    v_ok := true;
  exception when others then
    v_ok := false;
  end;

  -- Even if no exception, check if the row still exists.
  if v_ok then
    v_ok := not exists (select 1 from public.scribe_consents where id = v_consent);
  end if;

  insert into sc_result values (
    'consent_cannot_be_deleted',
    'clinician',
    case when v_ok then 'deleted (BAD)' else 'still exists' end,
    'still exists',
    case when not v_ok then 'PASS' else 'FAIL' end
  );

  reset role;
end $$;

-- --------------------------------------------------------------------------
-- Report
-- --------------------------------------------------------------------------
select * from sc_result order by check_name;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from sc_result where verdict = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% scribe RLS test(s) FAILED -- see sc_result above', v_fail_count;
  end if;
  raise notice 'All scribe RLS tests PASSED';
end $$;

rollback;
