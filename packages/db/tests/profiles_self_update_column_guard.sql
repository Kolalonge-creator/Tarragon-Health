-- ===========================================================================
-- Verification: profiles_guard_self_update (20260827192712_profiles_self_
-- update_column_guard.sql) blocks a patient session from changing role,
-- organisation_id, hiv_status, or is_partner_admin on their OWN profiles
-- row via a direct UPDATE, while leaving every other legitimate write path
-- untouched:
--   * the same patient can still update an allowed column (state) — proves
--     the guard is a narrow denylist, not an accidental lockout;
--   * an admin session can still change a patient's role/hiv_status;
--   * an org-staff (clinician) session can still change a patient's
--     identity_verified_at for a patient in their own org;
--   * the real production cascade — private.advance_serology_status()
--     setting hiv_status from an org-staff-inserted screening_results row —
--     still fires and persists correctly.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/clinician_phone_admin_visibility.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS (and this trigger's is_admin()/is_org_staff()
-- exemptions) via table ownership.
-- ===========================================================================

begin;

create temporary table psucg_fixture(k text primary key, v uuid) on commit drop;
create temporary table psucg_result(
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
  v_org       uuid;
  v_patient   uuid;
  v_clinician uuid := gen_random_uuid();
  v_admin     uuid := gen_random_uuid();
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

  insert into psucg_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('clinician', v_clinician), ('admin', v_admin);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_clinician, 'psucg-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'psucg-test-admin@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_clinician, v_org, 'clinician', 'PSUCG Test Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, null, 'admin', 'PSUCG Test Admin')
  on conflict (id) do update set role = excluded.role;

  insert into public.screen_types (code, name)
  values ('hiv', 'HIV')
  on conflict (code) do nothing;
end $$;

-- ==========================================================================
-- 1. Patient session cannot change their own role.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from psucg_fixture where k = 'patient');
  v_caught  boolean := false;
  v_msg     text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set role = 'admin' where id = v_patient;
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into psucg_result values
    ('patient self-escalates role', 'patient', coalesce(v_msg, 'not blocked'), 'blocked',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: patient session changed their own role';
  end if;
end $$;

-- ==========================================================================
-- 2. Patient session cannot change their own organisation_id.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from psucg_fixture where k = 'patient');
  v_other_org uuid := gen_random_uuid();
  v_caught  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set organisation_id = v_other_org where id = v_patient;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into psucg_result values
    ('patient self-escalates organisation_id', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: patient session changed their own organisation_id';
  end if;
end $$;

-- ==========================================================================
-- 3. Patient session cannot set their own hiv_status directly.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from psucg_fixture where k = 'patient');
  v_caught  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set hiv_status = 'hiv_negative' where id = v_patient;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into psucg_result values
    ('patient self-sets hiv_status', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: patient session set their own hiv_status directly';
  end if;
end $$;

-- ==========================================================================
-- 4. Sabotage control — the SAME patient session can still update an
--    allowed column. If this fails, the guard has overreached into a
--    column it was never meant to touch, not just the denylisted ones.
-- ==========================================================================
do $$
declare
  v_patient   uuid := (select v from psucg_fixture where k = 'patient');
  v_row_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set state = 'Lagos' where id = v_patient;
  get diagnostics v_row_count = row_count;
  reset role;

  insert into psucg_result values
    ('patient still updates allowed column (state)', 'patient', v_row_count::text, '1',
     case when v_row_count = 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 then
    raise exception 'BROKEN: guard blocked a patient from updating state, which is not denylisted';
  end if;
end $$;

-- ==========================================================================
-- 5. Admin session can still change a patient's role and hiv_status.
-- ==========================================================================
do $$
declare
  v_admin     uuid := (select v from psucg_fixture where k = 'admin');
  v_patient   uuid := (select v from psucg_fixture where k = 'patient');
  v_row_count bigint;
  v_readback  public.hiv_status;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set hiv_status = 'hiv_negative' where id = v_patient;
  get diagnostics v_row_count = row_count;
  select hiv_status into v_readback from public.profiles where id = v_patient;
  reset role;

  insert into psucg_result values
    ('admin updates patient hiv_status', 'admin', coalesce(v_readback::text, 'null'), 'hiv_negative',
     case when v_readback = 'hiv_negative' then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 or v_readback is distinct from 'hiv_negative' then
    raise exception 'BROKEN: admin session could not update a patient''s hiv_status';
  end if;
end $$;

-- ==========================================================================
-- 6. Org-staff (clinician) session can still change identity_verified_at
--    for a patient in their own organisation.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from psucg_fixture where k = 'clinician');
  v_patient   uuid := (select v from psucg_fixture where k = 'patient');
  v_now       timestamptz := now();
  v_row_count bigint;
  v_readback  timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set identity_verified_at = v_now where id = v_patient;
  get diagnostics v_row_count = row_count;
  select identity_verified_at into v_readback from public.profiles where id = v_patient;
  reset role;

  insert into psucg_result values
    ('org-staff updates patient identity_verified_at', 'clinician', coalesce(v_readback::text, 'null'), v_now::text,
     case when v_readback = v_now then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 or v_readback is distinct from v_now then
    raise exception 'BROKEN: org-staff session could not update a same-org patient''s identity_verified_at';
  end if;
end $$;

-- ==========================================================================
-- 7. Production regression: an org-staff-inserted screening_results row
--    (hiv, abnormal) still cascades through private.advance_serology_status
--    into the patient's hiv_status, unblocked by the new guard.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from psucg_fixture where k = 'org');
  v_clinician uuid := (select v from psucg_fixture where k = 'clinician');
  v_patient   uuid := (select v from psucg_fixture where k = 'patient');
  v_readback  public.hiv_status;
begin
  -- Reset to 'unknown' first (as admin, bypassing the guard on purpose) so
  -- the transition trigger's unknown -> hiv_positive branch actually fires.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from psucg_fixture where k = 'admin')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set hiv_status = 'unknown' where id = v_patient;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  values (v_org, v_patient, 'abnormal', 'hiv');
  reset role;

  select hiv_status into v_readback from public.profiles where id = v_patient;

  insert into psucg_result values
    ('advance_serology_status cascade still fires', 'clinician (cascade)', coalesce(v_readback::text, 'null'),
     'hiv_positive', case when v_readback = 'hiv_positive' then 'PASS' else 'FAIL' end);
  if v_readback is distinct from 'hiv_positive' then
    raise exception 'BROKEN: the new guard blocked advance_serology_status''s legitimate internal cascade';
  end if;
end $$;

-- ==========================================================================
-- 8. Patient session cannot set their own is_partner_admin directly. Added
--    after a concurrent session extended the live guard to cover this real
--    privileged column this test suite didn't originally know about (see
--    20260827192712's header) — the guard denylist now matches production.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from psucg_fixture where k = 'patient');
  v_caught  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set is_partner_admin = true where id = v_patient;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into psucg_result values
    ('patient self-sets is_partner_admin', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: patient session set their own is_partner_admin directly';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from psucg_result
order by verdict desc, check_name, role;

rollback;
