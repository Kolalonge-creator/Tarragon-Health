-- ===========================================================================
-- Verification: reproductive_health_profiles SELECT respects clinical_access,
-- after 20260830012429_reproductive_health_profiles_gate_on_can_read_clinical.sql.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data; it
-- always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/scoped_access_roles_rls.sql):
--   set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session. Running as the connecting superuser would
-- silently bypass RLS via table ownership.
--
-- Before this migration, a bare `profile_access` grant of ANY level — even a
-- 'view'-only grant meant for the non-clinical "appointments" tier — read this
-- table regardless of the patient's clinical_access switch. That is the exact
-- caregiver-oversharing scenario the platform's own consent model exists to
-- prevent, on the one table the 2026-07-31 clinical_access sweep missed.
--
-- One sabotage note worth keeping: `private.enforce_clinical_access_consent_owner()`
-- forces `clinical_access` to `false` on every INSERT into profile_access,
-- regardless of what the inserting statement asks for — only a later UPDATE,
-- run as the record owner's own session, can turn it on. A fixture that tries
-- to set clinical_access=true directly on insert silently gets false instead
-- and this test would pass vacuously (0 rows either way) without actually
-- exercising the can_read_clinical=true branch. This script does the
-- owner-session UPDATE deliberately, for that reason.
-- ===========================================================================

begin;

create temporary table rhp_result(check_name text, observed bigint, expected text, verdict text) on commit drop;

do $$
declare
  v_org               uuid;
  v_patient           uuid;
  v_dependent         uuid := gen_random_uuid();
  v_view_grantee      uuid := gen_random_uuid();
  v_clinical_grantee  uuid := gen_random_uuid();
  v_dependent_manager uuid := gen_random_uuid();
  v_count             bigint;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into auth.users (id, email) values
    (v_dependent, 'rhptest.dependent@example.com'),
    (v_view_grantee, 'rhptest.view.grantee@example.com'),
    (v_clinical_grantee, 'rhptest.clinical.grantee@example.com'),
    (v_dependent_manager, 'rhptest.dependent.manager@example.com');

  insert into public.profiles (id, organisation_id, role, full_name, is_dependent_account)
  values (v_dependent, v_org, 'patient', 'RHP Test Dependent', true)
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name, is_dependent_account = true;

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_view_grantee, v_org, 'patient', 'RHP Test View Grantee'),
    (v_clinical_grantee, v_org, 'patient', 'RHP Test Clinical Grantee'),
    (v_dependent_manager, v_org, 'patient', 'RHP Test Dependent Manager')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_view_grantee, 'view', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_clinical_grantee, 'manage', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_dependent, v_dependent_manager, 'manage', v_dependent_manager);

  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org, v_patient, 'menstruating')
  on conflict (patient_id) do update set life_stage = excluded.life_stage;
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org, v_dependent, 'menstruating')
  on conflict (patient_id) do update set life_stage = excluded.life_stage;

  -- Patient explicitly flips clinical_access on for the clinical grantee, as
  -- themself — the trigger requires the owner's own session for this.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profile_access set clinical_access = true
    where profile_id = v_patient and grantee_user_id = v_clinical_grantee;
  reset role;

  -- 1. View-only grantee, clinical_access left off — must be BLOCKED.
  perform set_config('request.jwt.claims', json_build_object('sub', v_view_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_patient;
  reset role;
  insert into rhp_result values ('view-only grantee, clinical_access=false', v_count, '0',
    case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'REGRESSION: view-only grantee can still read reproductive_health_profiles without clinical_access';
  end if;

  -- 2. Manage grantee, clinical_access explicitly switched on — must still see it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_patient;
  reset role;
  insert into rhp_result values ('manage grantee, clinical_access=true', v_count, '1',
    case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'BROKEN: a grantee with clinical_access=true can no longer read reproductive_health_profiles';
  end if;

  -- 3. Parent managing a dependent account (manage-level, clinical_access
  --    never explicitly toggled) — can_read_clinical's is_dependent_account
  --    branch must still cover this.
  perform set_config('request.jwt.claims', json_build_object('sub', v_dependent_manager::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_dependent;
  reset role;
  insert into rhp_result values ('dependent-account manager (manage, no explicit clinical_access)', v_count, '1',
    case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'BROKEN: a manage-level grantee on a dependent account can no longer read reproductive_health_profiles';
  end if;

  -- 4. Patient reads their own row — must still work.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_patient;
  reset role;
  insert into rhp_result values ('patient reads own row', v_count, '1',
    case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'BROKEN: a patient can no longer read their own reproductive_health_profiles row';
  end if;
end $$;

select * from rhp_result order by check_name;

rollback;
