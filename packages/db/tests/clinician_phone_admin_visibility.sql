-- ===========================================================================
-- Verification: a patient can no longer read a clinician's profiles row
-- (phone, DOB, HIV/HBV/HCV status, emergency contacts, ...) via the
-- care_plans.assigned_clinician_id RLS clause removed by
-- clinician_phone_admin_only_visibility.sql. Proves the replacement
-- name-only RPC (public.my_care_plan_clinicians()) still resolves correctly,
-- is properly patient-isolated, and that admin can still write phone.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/scoped_access_roles_rls.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS via table ownership.
--
-- Results are returned as a table (db query does not surface RAISE NOTICE),
-- and every check also raises on failure so the script cannot pass silently.
-- ===========================================================================

begin;

create temporary table cpav_fixture(k text primary key, v uuid) on commit drop;
create temporary table cpav_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures
-- --------------------------------------------------------------------------
do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_other_patient uuid := gen_random_uuid();
  v_clinician  uuid := gen_random_uuid();
  v_admin      uuid := gen_random_uuid();
  v_plan       uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles
  where role = 'patient' and organisation_id = v_org limit 1;

  insert into cpav_fixture(k, v) values
    ('org', v_org), ('patient', v_patient),
    ('other_patient', v_other_patient), ('clinician', v_clinician), ('admin', v_admin);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_other_patient, 'cpav-test-other-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_clinician, 'cpav-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'cpav-test-admin@example.invalid', 'x', now(), '{}', '{}');

  -- handle_new_user may already have created a profile from the auth.users
  -- insert; upsert so this works either way.
  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v_other_patient, v_org, 'patient', 'CPAV Test Other Patient', null)
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
        phone = excluded.phone;

  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v_clinician, v_org, 'clinician', 'CPAV Test Clinician', '+2348011112222')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name, phone = excluded.phone;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, null, 'admin', 'CPAV Test Admin')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.care_plans (organisation_id, patient_id, condition, status, assigned_clinician_id)
  values (v_org, v_patient, 'hypertension', 'active', v_clinician)
  returning id into v_plan;

  insert into cpav_fixture(k, v) values ('plan', v_plan);
end $$;

-- ==========================================================================
-- 1. The patient session can no longer read the clinician's profiles row at
--    all (not just "the app doesn't select phone" — the row itself, via
--    select *, is unreadable).
-- ==========================================================================
do $$
declare
  v_patient   uuid := (select v from cpav_fixture where k = 'patient');
  v_clinician uuid := (select v from cpav_fixture where k = 'clinician');
  v_count     bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.profiles where id = v_clinician;
  reset role;

  insert into cpav_result values
    ('patient reads clinician profiles row', 'patient', v_count::text, '0',
     case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'LEAK: patient session can still read the clinician''s profiles row directly (% rows)', v_count;
  end if;
end $$;

-- ==========================================================================
-- 2. my_care_plan_clinicians() still resolves the correct name for the
--    patient's own care plan.
-- ==========================================================================
do $$
declare
  v_patient      uuid := (select v from cpav_fixture where k = 'patient');
  v_clinician    uuid := (select v from cpav_fixture where k = 'clinician');
  v_plan         uuid := (select v from cpav_fixture where k = 'plan');
  v_expected     text;
  v_got          text;
  v_row_count    bigint;
begin
  select full_name into v_expected from public.profiles where id = v_clinician;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_row_count from public.my_care_plan_clinicians() where care_plan_id = v_plan;
  select clinician_full_name into v_got from public.my_care_plan_clinicians() where care_plan_id = v_plan;
  reset role;

  insert into cpav_result values
    ('my_care_plan_clinicians() row count', 'patient', v_row_count::text, '1',
     case when v_row_count = 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 then
    raise exception 'BROKEN: my_care_plan_clinicians() returned % rows for care_plan %, expected 1', v_row_count, v_plan;
  end if;

  insert into cpav_result values
    ('my_care_plan_clinicians() resolved name', 'patient', coalesce(v_got, 'null'), coalesce(v_expected, 'null'),
     case when v_got is not distinct from v_expected then 'PASS' else 'FAIL' end);
  if v_got is distinct from v_expected then
    raise exception 'BROKEN: my_care_plan_clinicians() returned % for care_plan %, expected %', v_got, v_plan, v_expected;
  end if;
end $$;

-- ==========================================================================
-- 3. Cross-patient isolation: an unrelated patient session gets 0 rows for
--    this care plan.
-- ==========================================================================
do $$
declare
  v_other uuid := (select v from cpav_fixture where k = 'other_patient');
  v_plan  uuid := (select v from cpav_fixture where k = 'plan');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.my_care_plan_clinicians() where care_plan_id = v_plan;
  reset role;

  insert into cpav_result values
    ('unrelated patient sees this care plan''s clinician', 'other_patient', v_count::text, '0',
     case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'LEAK: an unrelated patient session can resolve another patient''s care-plan clinician (% rows)', v_count;
  end if;
end $$;

-- ==========================================================================
-- 4. Admin can still update phone on an existing clinician profile.
-- ==========================================================================
do $$
declare
  v_admin     uuid := (select v from cpav_fixture where k = 'admin');
  v_clinician uuid := (select v from cpav_fixture where k = 'clinician');
  v_new_phone text := '+2348099999999';
  v_row_count bigint;
  v_readback  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.profiles set phone = v_new_phone where id = v_clinician;
  get diagnostics v_row_count = row_count;

  select phone into v_readback from public.profiles where id = v_clinician;
  reset role;

  insert into cpav_result values
    ('admin updates clinician phone (rows affected)', 'admin', v_row_count::text, '1',
     case when v_row_count = 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 then
    raise exception 'BROKEN: admin session could not update the clinician''s phone (% rows affected)', v_row_count;
  end if;

  insert into cpav_result values
    ('admin update read-back', 'admin', coalesce(v_readback, 'null'), v_new_phone,
     case when v_readback = v_new_phone then 'PASS' else 'FAIL' end);
  if v_readback is distinct from v_new_phone then
    raise exception 'BROKEN: phone update did not persist as expected (got %, expected %)', v_readback, v_new_phone;
  end if;
end $$;

select check_name, role, observed, expected, verdict
from cpav_result
order by verdict desc, check_name, role;

rollback;
