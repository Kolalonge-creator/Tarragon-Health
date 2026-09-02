-- ===========================================================================
-- Verification: profiles_guard_self_update (20260827192712_profiles_self_
-- update_column_guard.sql) blocks a patient session from changing role,
-- organisation_id, or is_partner_admin on their OWN profiles row via a
-- direct UPDATE, while leaving every other legitimate write path untouched:
--   * the same patient can still update an allowed column (state) — proves
--     the guard is a narrow denylist, not an accidental lockout;
--   * an admin session can still change a patient's role;
--   * an org-staff (clinician) session can still change a patient's
--     identity_verified_at for a patient in their own org;
--   * the real production cascade — private.advance_serology_status()
--     setting hiv_status from an org-staff-inserted screening_results row —
--     still fires and persists correctly.
--
-- Rewritten 2026-09-03: hiv_status moved off profiles entirely by
-- 20260830102308_extract_serology_status_from_profiles.sql (a live PHI
-- exposure fix — it was readable by any profile_access grantee, including a
-- bare view-only grant) into its own public.patient_serology_status table,
-- which carries no authenticated write policy for ANYONE — not the patient,
-- not even an admin — only private.advance_serology_status() (SECURITY
-- DEFINER) may write it, triggered by a real screening_results row. This
-- file's checks 3/5/7 originally exercised profiles.hiv_status directly;
-- confirmed live that column no longer exists at all
-- (information_schema.columns has zero hiv_status/hbv_status/hcv_status
-- columns on public.profiles). Rewritten against patient_serology_status
-- instead, which also strengthens check 5: an admin can no longer hand-edit
-- serology status either, only trigger it via a genuine screening result.
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
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, null, 'admin', 'PSUCG Test Admin')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

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
-- 3. Patient session cannot write patient_serology_status directly — not a
--    profiles-guard concern anymore, but RLS: the table has zero
--    INSERT/UPDATE/DELETE policies (only patient_serology_status_select),
--    so with no permissive write policy Postgres RLS makes every row
--    invisible to the write, not an error — an UPDATE affects 0 rows rather
--    than raising, so the check is row_count, not an exception. (Confirmed
--    live via has_table_privilege that `authenticated` actually holds full
--    table-level INSERT/UPDATE/DELETE grants here, wider than
--    20260830102308's own "grant select ... to authenticated" comment
--    implies — almost certainly inherited from this project's blanket
--    ALTER DEFAULT PRIVILEGES ... TO authenticated for new tables, see
--    reference_authenticated_table_grants_root_cause in project memory.
--    RLS is what actually closes this, not the grant, which is why this
--    check matters on its own rather than assuming the grant comment.)
-- ==========================================================================
do $$
declare
  v_patient   uuid := (select v from psucg_fixture where k = 'patient');
  v_row_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.patient_serology_status set hiv_status = 'hiv_negative' where patient_id = v_patient;
  get diagnostics v_row_count = row_count;
  reset role;

  insert into psucg_result values
    ('patient session cannot write patient_serology_status directly', 'patient', v_row_count::text,
     '0', case when v_row_count = 0 then 'PASS' else 'FAIL' end);
  if v_row_count <> 0 then
    raise exception 'LEAK: patient session updated % row(s) of patient_serology_status directly — it should have zero write policies for anyone, only private.advance_serology_status()', v_row_count;
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
-- 5. Admin session can still change a patient's role directly — but even an
--    admin session cannot write patient_serology_status directly either;
--    only private.advance_serology_status() may, via a real
--    screening_results row (proven in check 7).
-- ==========================================================================
do $$
declare
  v_admin           uuid := (select v from psucg_fixture where k = 'admin');
  v_patient         uuid := (select v from psucg_fixture where k = 'patient');
  v_row_count       bigint;
  v_readback_role   text;
  v_serology_rows   bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set role = 'patient' where id = v_patient;
  get diagnostics v_row_count = row_count;
  select role::text into v_readback_role from public.profiles where id = v_patient;

  update public.patient_serology_status set hiv_status = 'hiv_negative' where patient_id = v_patient;
  get diagnostics v_serology_rows = row_count;
  reset role;

  insert into psucg_result values
    ('admin updates patient role directly', 'admin', coalesce(v_readback_role, 'null'), 'patient',
     case when v_readback_role = 'patient' then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 or v_readback_role is distinct from 'patient' then
    raise exception 'BROKEN: admin session could not update a patient''s role';
  end if;

  insert into psucg_result values
    ('admin session also cannot write patient_serology_status directly', 'admin', v_serology_rows::text,
     '0', case when v_serology_rows = 0 then 'PASS' else 'FAIL' end);
  if v_serology_rows <> 0 then
    raise exception 'LEAK: an admin session updated % row(s) of patient_serology_status directly — it should have zero write policies for anyone, only the internal cascade', v_serology_rows;
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
--    into the patient's patient_serology_status.hiv_status.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from psucg_fixture where k = 'org');
  v_clinician uuid := (select v from psucg_fixture where k = 'clinician');
  v_patient   uuid := (select v from psucg_fixture where k = 'patient');
  v_readback  public.hiv_status;
begin
  -- Reset to 'unknown' first, as the connecting superuser (no authenticated
  -- session can write this table at all, per checks 3/5, so this reset
  -- cannot go through one) so the transition trigger's
  -- unknown -> hiv_positive branch actually fires.
  update public.patient_serology_status set hiv_status = 'unknown' where patient_id = v_patient;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  values (v_org, v_patient, 'abnormal', 'hiv');
  reset role;

  select hiv_status into v_readback from public.patient_serology_status where patient_id = v_patient;

  insert into psucg_result values
    ('advance_serology_status cascade still fires', 'clinician (cascade)', coalesce(v_readback::text, 'null'),
     'hiv_positive', case when v_readback = 'hiv_positive' then 'PASS' else 'FAIL' end);
  if v_readback is distinct from 'hiv_positive' then
    raise exception 'BROKEN: advance_serology_status''s legitimate internal cascade did not fire correctly';
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
