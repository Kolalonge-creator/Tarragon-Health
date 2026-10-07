-- ===========================================================================
-- Verification: testimonials_condition_check_and_doctor_org_match
-- (20260924212340_testimonials_condition_check_and_doctor_org_match.sql).
--
-- Proves the two gaps that migration closed, found on a /code-review high
-- pass of the testimonials condition-tagging + doctor_testimonials work:
--   * `condition` on both patient_testimonials and doctor_testimonials
--     rejects a value that isn't one of the two condition pages that
--     actually have a TestimonialsSection mounted — a bad value used to
--     insert silently and then render nowhere, indistinguishable from "no
--     testimonials yet";
--   * doctor_testimonials cannot reference a clinical_staff_id belonging to
--     a DIFFERENT organisation than the row's own organisation_id, even
--     though `private.is_admin()` (the RLS insert check) is TRUE
--     platform-wide, not scoped to one org;
--   * sabotage: disabling the new org-match trigger and re-attempting the
--     exact same cross-org insert makes it succeed — proving the trigger,
--     not some other constraint, is what blocks it (a test that can't fail
--     is not a test).
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table tcc_fixture(k text primary key, v uuid) on commit drop;
create temporary table tcc_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org_a   uuid;
  v_org_b   uuid;
  v_admin   uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_staff_a_profile uuid := gen_random_uuid();
  v_staff_b_profile uuid := gen_random_uuid();
  v_staff_a uuid;
  v_staff_b uuid;
begin
  select id into v_org_a from public.organisations limit 1;
  if v_org_a is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  -- A second, distinct org so the cross-org check has something real to
  -- reject. Reuses the same org-creation shape other proofs in this suite
  -- use when they need a second tenant.
  insert into public.organisations (id, name, type)
  values (gen_random_uuid(), 'TCC Test Org B', 'direct_consumer')
  returning id into v_org_b;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'tcc-admin@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient, 'tcc-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_a_profile, 'tcc-staff-a@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_b_profile, 'tcc-staff-b@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_admin, v_org_a, 'admin', 'TCC Admin'),
    (v_patient, v_org_a, 'patient', 'TCC Patient'),
    (v_staff_a_profile, v_org_a, 'clinician', 'Dr. TCC A'),
    (v_staff_b_profile, v_org_b, 'clinician', 'Dr. TCC B')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.clinical_staff
    (organisation_id, profile_id, doctor_tier, full_name, active, license_verified_at)
  values
    (v_org_a, v_staff_a_profile, 'medical_officer', 'Dr. TCC A', true, now())
  returning id into v_staff_a;

  insert into public.clinical_staff
    (organisation_id, profile_id, doctor_tier, full_name, active, license_verified_at)
  values
    (v_org_b, v_staff_b_profile, 'medical_officer', 'Dr. TCC B', true, now())
  returning id into v_staff_b;

  insert into tcc_fixture values
    ('org_a', v_org_a), ('org_b', v_org_b), ('admin', v_admin), ('patient', v_patient),
    ('staff_a', v_staff_a), ('staff_b', v_staff_b);
end $$;

-- ==========================================================================
-- 1. patient_testimonials.condition rejects an unknown value.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from tcc_fixture where k = 'patient');
  v_org     uuid := (select v from tcc_fixture where k = 'org_a');
  v_error   text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.patient_testimonials
      (organisation_id, patient_id, display_name, quote, condition, consent_to_publish, status)
    values
      (v_org, v_patient, 'TCC Patient', 'A quote tagged with a made-up condition slug.',
       'asthma-not-a-real-page', true, 'submitted');
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlstate;
  end;

  insert into tcc_result values
    ('patient_testimonials rejects an unknown condition', v_error, '23514',
     case when v_error = '23514' then 'PASS' else 'FAIL' end);
  if v_error <> '23514' then
    raise exception 'HOLE OPEN: patient_testimonials accepted condition = ''asthma-not-a-real-page'' (got %)', v_error;
  end if;
end $$;

-- ==========================================================================
-- 2. doctor_testimonials.condition rejects an unknown value.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from tcc_fixture where k = 'admin');
  v_org   uuid := (select v from tcc_fixture where k = 'org_a');
  v_staff uuid := (select v from tcc_fixture where k = 'staff_a');
  v_error text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.doctor_testimonials
      (organisation_id, clinical_staff_id, display_name, quote, condition, consent_reference, created_by)
    values
      (v_org, v_staff, 'Dr. TCC A', 'A quote tagged with a made-up condition slug.',
       'asthma-not-a-real-page', 'Signed release on file.', v_admin);
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlstate;
  end;

  insert into tcc_result values
    ('doctor_testimonials rejects an unknown condition', v_error, '23514',
     case when v_error = '23514' then 'PASS' else 'FAIL' end);
  if v_error <> '23514' then
    raise exception 'HOLE OPEN: doctor_testimonials accepted condition = ''asthma-not-a-real-page'' (got %)', v_error;
  end if;
end $$;

-- ==========================================================================
-- 3. A doctor_testimonials row cannot reference a clinical_staff_id from a
--    DIFFERENT organisation than the row's own organisation_id.
-- ==========================================================================
do $$
declare
  v_admin  uuid := (select v from tcc_fixture where k = 'admin');
  v_org_a  uuid := (select v from tcc_fixture where k = 'org_a');
  v_staff_b uuid := (select v from tcc_fixture where k = 'staff_b');
  v_error  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    -- org_a's admin, but staff_b belongs to org_b.
    insert into public.doctor_testimonials
      (organisation_id, clinical_staff_id, display_name, quote, consent_reference, created_by)
    values
      (v_org_a, v_staff_b, 'Dr. Cross-Org', 'This should be rejected: staff_b is org_b''s doctor.',
       'Signed release on file.', v_admin);
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlstate;
  end;

  insert into tcc_result values
    ('a cross-org clinical_staff_id is rejected', v_error, '23514',
     case when v_error = '23514' then 'PASS' else 'FAIL' end);
  if v_error <> '23514' then
    raise exception 'HOLE OPEN: doctor_testimonials accepted a clinical_staff_id from a different org (got %)', v_error;
  end if;
end $$;

-- ==========================================================================
-- 4. Sabotage: disable the org-match trigger and re-attempt the EXACT same
--    cross-org insert from step 3 — it must now succeed, proving the
--    trigger (not some other constraint) is what blocked it.
-- ==========================================================================
do $$
declare
  v_admin  uuid := (select v from tcc_fixture where k = 'admin');
  v_org_a  uuid := (select v from tcc_fixture where k = 'org_a');
  v_staff_b uuid := (select v from tcc_fixture where k = 'staff_b');
  v_status text;
begin
  alter table public.doctor_testimonials disable trigger doctor_testimonials_enforce_org_match;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.doctor_testimonials
    (organisation_id, clinical_staff_id, display_name, quote, consent_reference, created_by)
  values
    (v_org_a, v_staff_b, 'Dr. Cross-Org Sabotage', 'With the trigger off, this must go through.',
     'Signed release on file.', v_admin)
  returning status into v_status;
  reset role;

  alter table public.doctor_testimonials enable trigger doctor_testimonials_enforce_org_match;

  insert into tcc_result values
    ('sabotage: with the trigger disabled, the same cross-org insert succeeds', v_status, 'submitted',
     case when v_status = 'submitted' then 'PASS' else 'VACUOUS TEST' end);
  if v_status is distinct from 'submitted' then
    raise exception 'VACUOUS TEST: step 3''s rejection was not actually caused by doctor_testimonials_enforce_org_match';
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from tcc_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from tcc_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: testimonials condition CHECK + doctor org-match trigger all hold (% checks)', (select count(*) from tcc_result);
end $$;

rollback;
